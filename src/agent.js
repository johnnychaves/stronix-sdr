const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config({ override: true });
const db = require('./db');
const { notifyOwner } = require('./whatsapp');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

let SYSTEM_PROMPT = require('./prompt');

// Detecta se o lead confirmou ou negou o pedido de áudio
function isAffirmative(text) {
  return /^(sim|s\b|pode|claro|ok\b|tá|ta\b|vai|manda|mande|yes|é|boa|bora|com certeza|claro que sim|pode sim)/i.test(text.trim());
}

function isNegative(text) {
  return /^(n[aã]o|n\b|deixa|tranquilo|pode deixar|sem [aá]udio|prefiro texto|n[aã]o precisa)/i.test(text.trim());
}

// Estado por contato — agora persistido no SQLite.
// Retorna objeto normalizado em camelCase pros consumidores não saberem do banco.
function getContact(from) {
  const c = db.getOrCreateContact(from);
  return {
    phone: c.phone,
    name: c.name,
    audioPermission: !!c.audio_permission,
    awaitingAudioConfirm: !!c.awaiting_audio_confirm,
    askedForAudio: !!c.asked_for_audio,
    firstContactAt: c.first_contact_at,
    lastContactAt: c.last_contact_at,
  };
}

// Updater explícito pras flags de áudio (substitui mutação direta no objeto).
// Aceita updates parciais — campos não passados mantêm valor atual.
function setAudioFlags(from, updates) {
  const current = getContact(from);
  db.updateAudioFlags(from, {
    audioPermission: updates.audioPermission ?? current.audioPermission,
    awaitingAudioConfirm: updates.awaitingAudioConfirm ?? current.awaitingAudioConfirm,
    askedForAudio: updates.askedForAudio ?? current.askedForAudio,
  });
}

// Detecta se está em horário comercial fechado (madrugada, domingo, ou fora do expediente)
function isOutsideBusinessHours() {
  const now = new Date();
  // Converte pra fuso de Porto Alegre (BRT, UTC-3)
  const brt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const day = brt.getDay(); // 0 = domingo, 6 = sábado
  const hour = brt.getHours();
  const min = brt.getMinutes();

  // Domingo: fechado o dia todo
  if (day === 0) return true;
  // Sábado: 9h às 13h
  if (day === 6) return hour < 9 || hour >= 13;
  // Segunda a sexta: 6h às 22h30
  if (hour < 6) return true;
  if (hour > 22) return true;
  if (hour === 22 && min >= 30) return true;
  return false;
}

async function reply(from, text, { isAudio = false, forceAudio = false } = {}) {
  // Lê estado ANTES de adicionar a mensagem nova — assim isFirstMessage e
  // daysSinceLast refletem a situação real antes desse turno.
  const contact = getContact(from);
  const messageCountBefore = db.getMessageCount(from);
  const isFirstMessage = messageCountBefore === 0;
  const daysSinceLast = db.getDaysSinceLastContact(from);
  const isReturning = !isFirstMessage && daysSinceLast !== null && daysSinceLast > 30;

  // Lead mandou áudio ou pediu explicitamente → permissão permanente
  let audioPermission = contact.audioPermission;
  if (isAudio || forceAudio) {
    audioPermission = true;
    if (!contact.audioPermission) {
      setAudioFlags(from, { audioPermission: true });
    }
  }

  // Salva a mensagem do user e atualiza last_contact_at
  db.addMessage(from, 'user', text, isAudio);
  db.updateLastContact(from);

  // ─── CONTEXTO DINÂMICO (não cacheado, varia por mensagem) ───
  // Tudo que depende do estado da conversa (áudio, horário, retorno, primeiro turno)
  // vai num bloco separado pra não invalidar o cache do prompt estático.

  let dynamicCtx = '';

  // Áudio: estado de permissão e captura
  if (isAudio || forceAudio) {
    dynamicCtx += '\n\n[AUDIO_SERÁ_ENVIADO] — sua resposta será convertida em áudio de voz e enviada como mensagem de voz no WhatsApp. Escreva de forma completamente falada e natural: sem listas, sem bullets, sem formatação. Frases curtas como se estivesse gravando um áudio no celular. Não coloque tags, não mencione áudio, só fale naturalmente.';
  } else if (audioPermission) {
    dynamicCtx += '\n\n[AUDIO_LIBERADO] — o lead autorizou áudio nessa conversa. Você pode responder em áudio quando julgar que vai ajudar mais (objeção, fechamento, algo pessoal). Para escolher áudio, coloque [AUDIO] no início da resposta.';
  } else if (contact.askedForAudio) {
    dynamicCtx += '\n\n[AUDIO_JÁ_PEDIDO] — você já pediu permissão de áudio nessa conversa. Não peça de novo.';
  }

  // Fora do horário comercial (só na primeira mensagem)
  if (isOutsideBusinessHours() && isFirstMessage) {
    dynamicCtx += '\n\n[FORA_DO_HORÁRIO_COMERCIAL] — esse lead mandou mensagem fora do horário de funcionamento. Na primeira resposta, abra mencionando que é assistente virtual (cenário "LEAD MANDA MENSAGEM EM HORÁRIO COMERCIAL FECHADO" da Parte 8). Adapte ao tom do lead.';
  }

  // Lead retornando depois de muito tempo
  if (isReturning) {
    dynamicCtx += `\n\n[LEAD_RETORNANDO_APÓS_${daysSinceLast}_DIAS] — esse lead já conversou contigo há ${daysSinceLast} dias. Histórico completo dele está no messages acima. Reconheça o retorno com zero julgamento. NÃO comece do zero, NÃO se reapresente, NÃO peça nome se já souber. Tom acolhedor ("Bah, sumido!", "Tava te esperando"). Use a parte LEAD INATIVO da Parte 5.`;
  }

  // Primeira mensagem: marca o estado pro modelo aplicar a REGRA 1 do TOPO BLINDADO
  if (isFirstMessage) {
    dynamicCtx += '\n\n[PRIMEIRO_TURNO] — esta é a primeira mensagem dessa conversa. APLIQUE A REGRA 1 DO TOPO BLINDADO À RISCA: máximo 2 linhas, saudação curta + 1 pergunta binária, e nada mais. PROIBIDO listar valor, horário, endereço, plano, modalidade ou estrutura, mesmo que o lead tenha pedido várias coisas de uma vez. Reflita por 1 segundo se a resposta cabe nas 2 linhas. Se passou disso, está errada.';
  }

  // Histórico completo do banco (já inclui a mensagem do user que acabamos de salvar)
  const history = db.getHistory(from, 100);

  // ─── PROMPT CACHING ───
  // Bloco 1: SYSTEM_PROMPT estático com cache_control (cacheado por ~5min).
  // Bloco 2: contexto dinâmico (não cacheado).
  // Quando o prompt estático bate, ganha 90% de desconto no input cost.
  const systemBlocks = [
    {
      type: 'text',
      text: SYSTEM_PROMPT,
      cache_control: { type: 'ephemeral' },
    },
  ];
  if (dynamicCtx) {
    systemBlocks.push({ type: 'text', text: dynamicCtx });
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    system: systemBlocks,
    messages: history,
  });

  let answer = response.content[0].text;

  // Detecta tags de áudio na resposta (independente de posição)
  const useAudio = /\[AUDIO\]/i.test(answer);
  const askingForAudio = /\[PEDIR_AUDIO\]/i.test(answer);

  // Extrai apenas o conteúdo após [AUDIO] (descarta qualquer texto antes da tag)
  // Se não tiver [AUDIO], remove só o [PEDIR_AUDIO] do final
  let cleanText;
  if (useAudio) {
    const match = answer.match(/\[AUDIO\]\s*([\s\S]*)/i);
    cleanText = match ? match[1].trim() : answer.replace(/\[AUDIO\]/gi, '').trim();
  } else {
    cleanText = answer.replace(/\[PEDIR_AUDIO\]/gi, '').trim();
  }

  if (askingForAudio) {
    setAudioFlags(from, { awaitingAudioConfirm: true, askedForAudio: true });
  }

  // ─── DETECÇÃO DE AGENDAMENTO ───
  // Extrai tag [AGENDAMENTO:nome=X|dia=X|turno=X|modalidade=X] se presente,
  // salva no banco e notifica o dono. A tag é removida antes de enviar ao lead.
  const apptMatch = cleanText.match(/\[AGENDAMENTO:([^\]]+)\]/i);
  if (apptMatch) {
    const apptData = {};
    apptMatch[1].split('|').forEach(pair => {
      const [key, val] = pair.split('=');
      if (key && val) apptData[key.trim().toLowerCase()] = val.trim();
    });

    const currentContact = getContact(from);
    db.createAppointment(from, {
      name:          apptData.nome       || currentContact?.name || null,
      modality:      apptData.modalidade || null,
      scheduledDay:  apptData.dia        || null,
      scheduledTurn: apptData.turno      || null,
    });

    // Notifica o dono de forma assíncrona (não bloqueia a resposta)
    notifyOwner(from, apptData).catch(err =>
      console.error('[agent] erro ao notificar dono:', err.message)
    );

    // Remove a tag do texto antes de enviar ao lead
    cleanText = cleanText.replace(/\[AGENDAMENTO:[^\]]+\]/gi, '').trim();
    console.log(`[agent] 📅 agendamento registrado para ${from}: ${JSON.stringify(apptData)}`);
  }

  // Sanitiza em-dash (—) e en-dash (–) que o Claude insiste em usar
  // Substitui por vírgula+espaço (mais natural em conversa de WhatsApp)
  const beforeSanitize = cleanText;
  cleanText = cleanText.replace(/\s*[—–]\s*/g, ', ');
  if (beforeSanitize !== cleanText) {
    console.log(`[agent] sanitizou traço longo na resposta para ${from}`);
  }

  // Salva a resposta do assistente
  db.addMessage(from, 'assistant', cleanText, useAudio);

  const returnTag = isReturning ? ` (retorno após ${daysSinceLast}d)` : '';
  console.log(`[agent] ${from}${returnTag} → "${text.slice(0, 40)}" | ${useAudio ? '🔊' : '💬'} "${cleanText.slice(0, 60)}..."`);

  return { text: cleanText, useAudio, askingForAudio };
}

function getSystemPrompt() {
  return SYSTEM_PROMPT;
}

function updateSystemPrompt(newPrompt) {
  SYSTEM_PROMPT = newPrompt;
  console.log('[agent] system prompt atualizado via painel admin');
}

function getConversations() {
  return db.getAllConversations();
}

function clearConversation(from) {
  db.clearConversation(from);
}

module.exports = { reply, isAffirmative, isNegative, getContact, setAudioFlags, getSystemPrompt, updateSystemPrompt, getConversations, clearConversation };
