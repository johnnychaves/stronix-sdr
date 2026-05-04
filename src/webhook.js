const { Router } = require('express');
const config    = require('./config');
const { reply, isAffirmative, isNegative, getContact, setAudioFlags } = require('./agent');
const { replyV2 } = require('./agent-v2');
const wa = require('./whatsapp');

// Toggle entre Johnny v1 (prompt monolítico), v2 (núcleo + módulos) e v3 (tool use forçado).
// Default v2 desde 2026-05-03 — v1 fica como fallback de emergência.
// PR1 da migração v3 (2026-05-04): v3 é opt-in via AGENT_VERSION=v3 (env Railway) ou
// override em DB. Default código continua 'v2'. v3 só entra rota com override explícito.
// Se v2 quebrar em prod, admin pausa via Monitor v2 (DB flag) que vira pra v1
// instantâneo sem precisar restart. Pra reverter permanentemente: setar
// AGENT_VERSION=v1 na env do Railway.
const AGENT_VERSION_ENV = (process.env.AGENT_VERSION || 'v2').toLowerCase();
console.log(`[webhook] agent version (env): ${AGENT_VERSION_ENV}`);

// Resolve a cada request — barato (1 query SQLite indexada). Permite admin
// flipar instantâneo via UI sem mexer em variável Railway.
//
// PR3 (2026-05-04): roteamento agora é PHONE-LOCKED via hash determinístico
// quando env=v3 e rollout_pct < 100. Lead que cai em v3 numa conversa NUNCA
// migra pra v2 mid-conv (mesmo phone, mesmo bucket — mover threshold só
// afeta novos phones que cruzem a fronteira). Override de admin tem
// prioridade absoluta (pause force). Sem phone (sanity calls em playground),
// usa caminho global antigo.
function getCurrentAgentVersion(phone = null) {
  try {
    if (phone) {
      return require('./db').getAgentVersionForPhone(phone, AGENT_VERSION_ENV);
    }
    // Sem phone: caminho legacy — só override + env (sem rollout).
    const override = require('./db').getRuntimeFlag('agent_version_override');
    if (override === 'v1' || override === 'v2' || override === 'v3') return override;
  } catch { /* DB pode estar inicializando */ }
  return AGENT_VERSION_ENV;
}
const { sendMessage, notifyStudent, notifyAssignedConsultor, PROVIDER } = wa;
const { transcribeAudio, transcribeAudioBuffer } = require('./transcriber');
const { textToAudioMessage } = require('./tts');
const db = require('./db');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Mesmo MEDIA_DIR usado pelo painel pra salvar áudio enviado por humano.
// Aqui vamos salvar áudio gerado pela IA (TTS) também, pra player no painel.
const MEDIA_DIR = process.env.MEDIA_DIR || (() => {
  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'database.sqlite');
  return path.join(path.dirname(dbPath), 'media');
})();
if (!fs.existsSync(MEDIA_DIR)) {
  try { fs.mkdirSync(MEDIA_DIR, { recursive: true }); } catch {}
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Delay antes de enviar resposta de texto, simulando SDR humano que está
// atendendo várias conversas em paralelo. Proporcional ao tamanho — curta
// usa MIN, longa (300+ chars) usa MAX. MIN/MAX editáveis pelo painel via
// agent_config (chaves typing_delay_min_ms / typing_delay_max_ms).
function typingDelayMs(text) {
  const MIN_MS = db.getAgentConfigNumber('typing_delay_min_ms', 60 * 1000, 0, 600 * 1000);
  const MAX_MS = db.getAgentConfigNumber('typing_delay_max_ms', 180 * 1000, 0, 600 * 1000);
  const FULL_LEN = 300;
  const ratio = Math.min(1, (text || '').length / FULL_LEN);
  // Garante MIN <= MAX (defensive — se admin setar invertido)
  const lo = Math.min(MIN_MS, MAX_MS);
  const hi = Math.max(MIN_MS, MAX_MS);
  return Math.round(lo + (hi - lo) * ratio);
}

// ─────────────────────────────────────────────────────────────────────
// BUFFER DE MENSAGENS (debouncing por phone)
//
// Lead/aluno costuma fragmentar pensamento em várias mensagens curtas
// ("oi" → "tem aula?" → "qual valor?"). Sem buffer, cada uma vira webhook
// independente, IA processa 3x e responde fora de ordem (especialmente
// com delay de 1-3 min entre processamento e envio).
//
// Solução: acumula msgs do mesmo phone numa janela de 15s sem nova msg.
// Quando timer expira, processa o batch concatenado como UMA conversa.
// ─────────────────────────────────────────────────────────────────────

// Janela de debounce do buffer — editável via painel (chave buffer_window_ms).
// Default 15s. Lido a cada enqueue pra refletir mudança sem restart.
function getBufferWindowMs() {
  return db.getAgentConfigNumber('buffer_window_ms', 15 * 1000, 1000, 120 * 1000);
}
const buffers = new Map(); // phone -> { messages: [{text, isAudio}], timer }

function enqueueMessage(from, text, isAudio, audioFilename = null) {
  let buf = buffers.get(from);
  if (!buf) {
    buf = { messages: [], timer: null };
    buffers.set(from, buf);
  }
  buf.messages.push({ text, isAudio, audioFilename });
  if (buf.timer) clearTimeout(buf.timer);
  const windowMs = getBufferWindowMs();
  buf.timer = setTimeout(() => flushBuffer(from), windowMs);
  console.log(`[buffer] ${from} acumulou ${buf.messages.length} msg(s) — aguardando ${windowMs / 1000}s sem nova msg pra processar`);
}

function flushBuffer(from) {
  const buf = buffers.get(from);
  if (!buf || !buf.messages.length) {
    buffers.delete(from);
    return;
  }
  buffers.delete(from);

  const messages = buf.messages;
  const text       = messages.map(m => m.text).join('\n');
  const anyAudio   = messages.some(m => m.isAudio);
  const firstText  = messages.find(m => !m.isAudio)?.text || '';
  const explicitAudio = !anyAudio && messages.some(m => isExplicitAudioRequest(m.text));
  // Se houver áudio(s) no batch, pega o primeiro filename salvo pro player.
  // Múltiplos áudios concatenam transcrições mas só o primeiro vira player —
  // raro o lead mandar 2+ áudios em <15s. Aceitável.
  const firstAudioFilename = messages.find(m => m.isAudio && m.audioFilename)?.audioFilename || null;

  console.log(`[buffer] flush ${from}: ${messages.length} msg(s) concatenadas (${text.length} chars)`);

  processBatch(from, { text, anyAudio, explicitAudio, firstText, firstAudioFilename }).catch(err => {
    console.error(`[buffer] erro ao processar batch de ${from}:`, err.message);
  });
}

async function processBatch(from, { text, anyAudio, explicitAudio, firstText, firstAudioFilename = null }) {
  // Roteamento aluno vs lead — antes de qualquer IA
  const student = db.getStudent(from);
  if (student) {
    const firstName = student.name ? student.name.split(/\s*\/\s*/)[0].split(/\s+/)[0] : '';
    const greet = firstName ? `Oi ${firstName}!` : 'Oi!';
    const studentReply = `${greet} Aqui é o assistente da academia, mas pra coisas de aluno eu te passo direto pra equipe. Já avisei eles e logo te respondem 👋`;
    console.log(`[webhook] phone ${from} é aluno cadastrado (${student.name || 'sem nome'}) — desviando IA`);
    await sleep(typingDelayMs(studentReply));
    await sendMessage(from, studentReply);
    await notifyStudent(from, student, text);
    return;
  }

  // Handoff humano: se uma consultora/admin assumiu essa conversa, IA NÃO responde.
  // Salva a msg do lead no histórico (não chama Claude) e notifica a consultora.
  const assignment = db.getContactAssignment(from);
  if (assignment && assignment.humanAssumedAt) {
    db.getOrCreateContact(from);
    db.addMessageWithSender(from, 'user', text, anyAudio, null);
    db.updateLastContact(from);
    // Lead's incoming audio: anexa o filename salvo em disco pra player no painel
    if (anyAudio && firstAudioFilename) {
      try { db.setLastUserAudioMessageMediaPath(from, firstAudioFilename); } catch {}
    }
    const assignedUser = assignment.assignedUserId ? db.getUserById(assignment.assignedUserId) : null;
    const fallbackUsers = assignedUser ? [] : [...db.getActiveAdmins(), ...db.getActiveConsultors()];
    console.log(`[webhook] ${from} em atendimento humano (${assignedUser?.display_name || 'sem dono'}) — IA não responde`);
    await notifyAssignedConsultor({
      leadPhone: from,
      assignedUser,
      fallbackUsers,
      incomingText: text,
    });
    return;
  }

  const contact = getContact(from);
  let forceAudio = false;

  if (anyAudio) {
    forceAudio = true;
    console.log(`[webhook] alguma msg do batch foi áudio → resposta forçada em áudio`);
  } else if (explicitAudio) {
    forceAudio = true;
    console.log(`[webhook] alguma msg pediu áudio explicitamente → resposta forçada em áudio`);
  } else if (contact.awaitingAudioConfirm) {
    if (isAffirmative(firstText)) {
      setAudioFlags(from, { awaitingAudioConfirm: false, audioPermission: true });
      forceAudio = true;
      console.log(`[webhook] lead confirmou áudio`);
    } else if (isNegative(firstText)) {
      setAudioFlags(from, { awaitingAudioConfirm: false });
      console.log(`[webhook] lead recusou áudio — continuando em texto`);
    } else {
      setAudioFlags(from, { awaitingAudioConfirm: false });
    }
  }

  // Roteamento por versão do agente. PR3: phone-locked via hash determinístico.
  // v3 usa tool use forçado da Anthropic (PR1 da migração v3, 2026-05-04) — opt-in.
  // v2 usa núcleo + módulos + tags em texto livre — default em produção.
  // v1 é o prompt monolítico antigo — fallback de emergência.
  // Override de admin (Monitor → Pausar) > rollout_pct (se env=v3) > env var.
  const currentVersion = getCurrentAgentVersion(from);
  let result;
  if (currentVersion === 'v3') {
    const { replyV3 } = require('./agent-v3');
    result = await replyV3(from, text, { isAudio: anyAudio });
  } else if (currentVersion === 'v2') {
    result = await replyV2(from, text, { isAudio: anyAudio });
  } else {
    result = await reply(from, text, { isAudio: anyAudio, forceAudio });
  }
  const shouldSendAudio = forceAudio || result.useAudio;

  // Lead's incoming audio: agent.reply já salvou a msg user com was_audio=true mas
  // sem media_path. Anexa o filename salvo em disco pra player no painel.
  if (anyAudio && firstAudioFilename) {
    try { db.setLastUserAudioMessageMediaPath(from, firstAudioFilename); } catch {}
  }

  if (shouldSendAudio) {
    console.log(`[webhook] enviando resposta em áudio para ${from}`);
    try {
      const audio = await textToAudioMessage(result.text);
      if (audio && audio.buffer) {
        // Salva o MP3 em disco pra player no painel
        const filename = `${crypto.randomUUID()}.mp3`;
        try {
          fs.writeFileSync(path.join(MEDIA_DIR, filename), audio.buffer);
          // Atualiza a última msg assistant deste phone com o media_path
          // (agent.reply já salvou ela como was_audio=true mas sem o path)
          db.setLastAssistantMessageMediaPath(from, filename);
        } catch (e) {
          console.error('[webhook] erro ao salvar áudio em disco:', e.message);
          // não falha o envio
        }
        await wa.sendVoice(from, audio.buffer, audio.mimeType || 'audio/mpeg', 'voice.mp3');
      } else if (typeof audio === 'string') {
        // Compat antigo (mediaId Meta)
        await wa.sendAudio(from, audio);
      } else {
        throw new Error('TTS retornou formato inesperado');
      }
    } catch (err) {
      console.error('[webhook] erro ao gerar/enviar áudio, enviando como texto:', err.message);
      await sleep(typingDelayMs(result.text));
      await sendMessage(from, result.text);
    }
  } else {
    await sleep(typingDelayMs(result.text));
    await sendMessage(from, result.text);
  }
}

// ─────────────────────────────────────────────────────────────────────
// HANDLER UNIFICADO — chamado tanto por HTTP webhook (Meta) quanto por
// event listener Baileys. Aceita formato parsed { from, type, text?,
// audioBuffer?, audioMime? }.
// ─────────────────────────────────────────────────────────────────────
async function handleIncomingMessage(parsed) {
  const { from, type } = parsed;
  let text = parsed.text;
  let isAudio = type === 'audio';
  let savedAudioFilename = null;

  if (type === 'audio') {
    // Salva o áudio bruto em disco ANTES de transcrever, pra player no painel
    // mesmo se a transcrição falhar. Filename é uuid.<ext> baseado no mime.
    try {
      const mime = parsed.audioMime || 'audio/ogg';
      const ext = mime.includes('mpeg') || mime.includes('mp3') ? 'mp3'
               : mime.includes('mp4')  ? 'mp4'
               : mime.includes('ogg')  ? 'ogg'
               : mime.includes('webm') ? 'webm'
               : 'bin';
      savedAudioFilename = `${crypto.randomUUID()}.${ext}`;
      fs.writeFileSync(path.join(MEDIA_DIR, savedAudioFilename), parsed.audioBuffer);
    } catch (e) {
      console.error('[webhook] não consegui salvar áudio recebido em disco:', e.message);
      savedAudioFilename = null;
    }

    try {
      text = await transcribeAudioBuffer(parsed.audioBuffer, parsed.audioMime);
      console.log(`[webhook] transcrição de ${from}: "${text}"`);
    } catch (err) {
      console.error('[webhook] erro ao transcrever áudio:', err.message);
      await sendMessage(from, 'Recebi seu áudio, mas não consegui entender. Pode me mandar por texto?');
      return;
    }
    if (!text || !text.trim()) {
      await sendMessage(from, 'Não consegui entender o áudio. Pode repetir ou mandar por texto?');
      return;
    }
  } else if (type !== 'text') {
    console.log(`[webhook] tipo não suportado ignorado: ${type}`);
    return;
  }

  enqueueMessage(from, text, isAudio, savedAudioFilename);
}

// Detecta quando o lead pede explicitamente áudio por texto
function isExplicitAudioRequest(text) {
  return /(fala|manda|pode mandar|responde?|me manda|prefiro|quero|me fala).{0,20}(áudio|audio|voz)/i.test(text)
    || /^(áudio|audio|por áudio|em áudio|via áudio|no áudio)/i.test(text.trim())
    || /^(manda|fala|pode).{0,10}(áudio|audio)/i.test(text.trim());
}

const router = Router();

// Verificação do webhook exigida pelo Meta ao cadastrar a URL
router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.webhook.verifyToken) {
    console.log('[webhook] verificado pelo Meta');
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

// Recebe mensagens enviadas ao número
router.post('/', async (req, res) => {
  res.sendStatus(200); // responde rápido para o Meta não reenviar

  const entry = req.body?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;

  // ─── Status callbacks (✓ enviado / ✓✓ entregue / ✓✓ lido) ───
  // Meta envia eventos de status pra cada msg que enviamos. Captura aqui
  // pra gravar no DB e renderizar checkmarks no painel.
  const statuses = value?.statuses;
  if (Array.isArray(statuses) && statuses.length) {
    for (const s of statuses) {
      try {
        db.updateMessageDeliveryStatus(s.id, s.status, s.timestamp ? Number(s.timestamp) : null);
      } catch (e) {
        console.error('[webhook] erro ao atualizar status:', e.message);
      }
    }
    return; // status-only, sem mensagem nova pra processar
  }

  const message = value?.messages?.[0];
  if (!message) return;

  const from = message.from;
  if (message.type === 'text') {
    console.log(`[webhook] texto de ${from}: "${message.text.body}"`);
    await handleIncomingMessage({ from, type: 'text', text: message.text.body });
  } else if (message.type === 'audio') {
    console.log(`[webhook] áudio recebido de ${from}, baixando + transcrevendo...`);
    try {
      const { buffer, mimeType } = await wa.downloadMediaBuffer(message.audio.id);
      await handleIncomingMessage({ from, type: 'audio', audioBuffer: buffer, audioMime: mimeType });
    } catch (err) {
      console.error('[webhook] erro ao baixar áudio:', err.message);
      await sendMessage(from, 'Recebi seu áudio, mas não consegui processar. Pode me mandar por texto?');
    }
  } else {
    console.log(`[webhook] tipo não suportado ignorado: ${message.type}`);
  }
});

module.exports = router;
module.exports.handleIncomingMessage = handleIncomingMessage;
// PR #37: helpers exportados pra admin.js usar nos endpoints /v2/version e /v2/pause
module.exports.getCurrentAgentVersion = getCurrentAgentVersion;
module.exports.AGENT_VERSION_ENV = AGENT_VERSION_ENV;
