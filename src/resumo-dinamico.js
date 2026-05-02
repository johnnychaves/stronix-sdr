// ═══════════════════════════════════════════════════════════════
// RESUMO DINÂMICO — comprime histórico longo em background
// ═══════════════════════════════════════════════════════════════
//
// Fase 3 do plano de refatoração v2 (PR #36). Conversas longas (20+ msgs)
// passam a alimentar o prompt como (RESUMO_ESTRUTURADO + últimas N msgs)
// em vez de histórico completo de 50 msgs cheias. Resumo gerado por
// Haiku 4.5 (barato, rápido) em background — não bloqueia replyV2.
//
// Trigger: total_msgs ≥ 20 OU update incremental a cada 10 msgs novas.
// Custo: ~$0,001 por update. Conversa de 50 msgs = 1+1 update ≈ $0,002.
// Latência adicional na resposta principal: 0 (background fire-and-forget).
//
// Escolha de modelo: Sonnet 4.5 (~$0,01/turn) é overkill pra sumarização
// estruturada. Haiku 4.5 (~$0,001) é o caso ideal — tarefa instrucional
// curta, formato fixo, baixa criatividade exigida.

const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');
const db = require('./db');

const haiku = new Anthropic({ apiKey: config.anthropic.apiKey });
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// Threshold pra começar a resumir (10 turnos = 20 mensagens, contando
// user+assistant). Antes disso, histórico cabe direto sem custo.
const TRIGGER_THRESHOLD = 20;

// A cada quantas msgs novas re-gera o resumo (incremental).
// Trade-off: número alto = resumo desatualiza, número baixo = custo sobe.
const UPDATE_EVERY_N_MSGS = 10;

// Limite de chars do resumo gerado. Haiku respeita o formato; este é
// só um sanity check em casos patológicos.
const MAX_RESUMO_CHARS = 2000;

// ═══════════════════════════════════════════════════════════════
// DECISÃO: deve atualizar agora?
// ═══════════════════════════════════════════════════════════════

// Pure: decide com base no estado atual + total de msgs se vale gerar resumo.
// Retorna { shouldUpdate, reason } — mais fácil de testar e logar.
function shouldUpdateResumo(state, totalMsgs) {
  if (!state || totalMsgs < TRIGGER_THRESHOLD) {
    return { shouldUpdate: false, reason: `abaixo do threshold (${totalMsgs}/${TRIGGER_THRESHOLD})` };
  }
  const nResumidas = state.resumo_dinamico_n_msgs || 0;
  if (nResumidas === 0) {
    return { shouldUpdate: true, reason: `primeiro resumo (${totalMsgs} msgs)` };
  }
  const novasMsgs = totalMsgs - nResumidas;
  if (novasMsgs >= UPDATE_EVERY_N_MSGS) {
    return { shouldUpdate: true, reason: `update incremental (+${novasMsgs} msgs novas)` };
  }
  return { shouldUpdate: false, reason: `só ${novasMsgs} msgs novas (precisa ${UPDATE_EVERY_N_MSGS})` };
}

// ═══════════════════════════════════════════════════════════════
// GERAÇÃO DO RESUMO via Haiku
// ═══════════════════════════════════════════════════════════════

// Limpa tags de sistema do conteúdo das msgs antes de mandar pro Haiku
// (não precisa que o Haiku veja [ESTADO:...] etc, é ruído pra ele).
function stripTags(content) {
  return content
    .replace(/\[ESTADO:[^\]]+\]\s*\n?/gi, '')
    .replace(/\[MODULO_REQUERIDO:[^\]]+\]\s*\n?/gi, '')
    .replace(/\[AGENDAMENTO:[^\]]+\]\s*\n?/gi, '')
    .replace(/\[AUDIO\]\s*/gi, '')
    .replace(/\[PEDIR_AUDIO\]\s*/gi, '')
    .trim();
}

// Formata histórico [{role, content}] como transcrição legível.
function formatTranscript(messages) {
  return messages
    .map(m => {
      const who = m.role === 'user' ? 'LEAD' : 'JOHNNY';
      return `${who}: ${stripTags(m.content)}`;
    })
    .filter(line => line.length > 5) // remove linhas vazias
    .join('\n');
}

// Chama Haiku 4.5 e retorna resumo estruturado em texto markdown.
// Async pure: recebe msgs + nome opcional, retorna string ou '' em erro.
async function gerarResumo(messages, contactName = null) {
  if (!messages || !messages.length) return '';
  const transcript = formatTranscript(messages);
  if (!transcript || transcript.length < 50) return ''; // muito curto pra valer

  const prompt = `Você é um assistente que resume conversas de WhatsApp entre o Johnny (SDR da STRONIX academia em Porto Alegre) e um lead. O resumo será injetado no prompt do Johnny pra que ele continue a conversa SEM precisar reler tudo. Foco no que é OPERACIONAL pro próximo turno — não comentário.

CONVERSA:
${transcript}

Responda EXATAMENTE neste formato (markdown, ~300-500 chars no total). Se faltar info, escreva "—". NÃO INVENTE nada que não esteja na conversa:

LEAD: ${contactName || '[nome se mencionado, ou "—"]'}, [perfil em 1 frase]
OBJETIVO: [resultado_fisico | qualidade_vida | massa | emagrecer | outro | —]
PONTOS CHAVE: [bullet list de 2-4 itens — modalidade preferida, disponibilidade declarada, restrições de saúde, contexto de vida, etc]
OBJEÇÕES TRATADAS: [lista de objeções que apareceram, ou "nenhuma"]
PENDENTE: [o que o lead ainda precisa responder OU o que Johnny deve fazer no próximo turno]
TOM: [engajado | cético | resistente | com pressa | confuso | outro]`;

  const response = await haiku.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content?.[0]?.text?.trim() || '';
  if (text.length > MAX_RESUMO_CHARS) return text.slice(0, MAX_RESUMO_CHARS);
  return text;
}

// ═══════════════════════════════════════════════════════════════
// UPDATE EM BACKGROUND (fire-and-forget seguro)
// ═══════════════════════════════════════════════════════════════

// Atualiza o resumo dinâmico de um lead se shouldUpdateResumo permitir.
// Captura erros internamente — não derruba o processo principal.
// Retorna { updated, reason, resumoLen, totalMsgs } pra debug/log.
async function updateResumoDinamicoBackground(phone) {
  try {
    const state = db.getLeadState(phone);
    if (!state) return { updated: false, reason: 'sem lead_state' };

    const totalMsgs = db.getMessageCount(phone);
    const decision = shouldUpdateResumo(state, totalMsgs);
    if (!decision.shouldUpdate) {
      return { updated: false, reason: decision.reason, totalMsgs };
    }

    const allMsgs = db.getAllMessages(phone);
    const contact = db.getContact(phone);
    const resumo = await gerarResumo(allMsgs, contact?.name);
    if (!resumo) {
      return { updated: false, reason: 'Haiku retornou vazio', totalMsgs };
    }

    db.updateLeadState(phone, {
      resumo_dinamico: resumo,
      resumo_dinamico_n_msgs: totalMsgs,
    });

    console.log(`[resumo-dinamico] ${phone} → ${totalMsgs} msgs resumidas, ${resumo.length} chars (${decision.reason})`);
    return { updated: true, reason: decision.reason, resumoLen: resumo.length, totalMsgs };
  } catch (err) {
    console.error(`[resumo-dinamico] erro ao atualizar ${phone}:`, err.message);
    return { updated: false, reason: 'erro: ' + err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPER PRA MONTAR BLOCO DO RESUMO PRO PROMPT
// ═══════════════════════════════════════════════════════════════

// Retorna string formatada pra injetar no system block, ou '' se sem resumo.
function buildResumoBlock(state) {
  if (!state?.resumo_dinamico) return '';
  return `═══ RESUMO DA CONVERSA ANTERIOR ═══\n\n${state.resumo_dinamico}\n\n(Acima é resumo das primeiras ${state.resumo_dinamico_n_msgs || 0} mensagens. Abaixo seguem as mensagens mais recentes na íntegra.)`;
}

module.exports = {
  shouldUpdateResumo,
  gerarResumo,
  updateResumoDinamicoBackground,
  buildResumoBlock,
  formatTranscript,
  stripTags,
  TRIGGER_THRESHOLD,
  UPDATE_EVERY_N_MSGS,
  MAX_RESUMO_CHARS,
};
