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

// As 10 seções obrigatórias do resumo, conforme Anexo 5 do doc mestre
// (docs/refactoring/engrenagens-roteador-extrator-schema.md, seção 4).
const RESUMO_SECOES = [
  'LEAD',
  'OBJETIVO',
  'DISPONIBILIDADE',
  'MODALIDADE INDICADA',
  'INSISTÊNCIAS DE VALOR',
  'OBJEÇÕES JÁ LEVANTADAS',
  'NÍVEL DE ENGAJAMENTO',
  'INFOS PESSOAIS RELEVANTES',
  'HISTÓRICO DE TENTATIVAS DE FECHAMENTO',
  'PRÓXIMA AÇÃO RECOMENDADA',
];

// Sanity check: valida que o retorno do Haiku tem PELO MENOS 3 das 10 seções
// esperadas no formato "SEÇÃO: ...". Se falhar, descarta retorno e deixa
// próximo trigger tentar de novo (log + return false).
// Threshold de 3 (não 10) é deliberado — Haiku às vezes funde seções vazias,
// mas estrutura mínima precisa estar presente. Tudo que escapa a 3 é provável
// alucinação não-formatada (texto livre).
const MIN_SECOES_VALIDAS = 3;
function validateResumoSchema(text) {
  if (!text || typeof text !== 'string') return false;
  let count = 0;
  for (const secao of RESUMO_SECOES) {
    // Match começo de linha, case-insensitive, com ":" depois
    const re = new RegExp(`^${secao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`, 'mi');
    if (re.test(text)) count++;
  }
  return count >= MIN_SECOES_VALIDAS;
}

// Chama Haiku 4.5 e retorna resumo estruturado em texto markdown.
// Async pure: recebe msgs + nome opcional + state opcional, retorna string ou '' em erro/inválido.
// Anexo 5 / Seção 4: 10 seções obrigatórias. Insistencias_valor vem do state
// (não do transcript) porque Haiku não tem como contar com precisão.
async function gerarResumo(messages, contactName = null, state = null) {
  if (!messages || !messages.length) return '';
  const transcript = formatTranscript(messages);
  if (!transcript || transcript.length < 50) return ''; // muito curto pra valer

  // Contexto numérico vindo do state (mais confiável que pedir Haiku contar)
  const insistVal = state?.insistencias_valor || 0;
  const objHist = Array.isArray(state?.objecoes_levantadas) ? state.objecoes_levantadas.join(', ') : '';

  const prompt = `Você é um sumarizador de conversas do agente SDR Johnny da STRONIX academia (Porto Alegre).

Sua tarefa: gerar um resumo estruturado e curto da conversa abaixo, focando no que importa pra continuar o atendimento.

Devolva APENAS o resumo no formato indicado. Sem preâmbulo, sem comentário.

CONTEXTO ADICIONAL (use no resumo, não invente):
- Nome do contato no DB: ${contactName || 'não informado'}
- Insistências de valor já contabilizadas pelo backend: ${insistVal}
- Objeções já registradas no histórico: ${objHist || 'nenhuma'}

CONVERSA A RESUMIR:
${transcript}

FORMATO OBRIGATÓRIO (devolva EXATAMENTE estas 10 linhas, nessa ordem, com ":" depois do nome da seção):

LEAD: [nome se conhecido, "não informado" caso contrário]
OBJETIVO: [resultado físico / qualidade de vida / emagrecer / ganhar massa / não declarado]
DISPONIBILIDADE: [manhã / tarde / não declarada]
MODALIDADE INDICADA: [musculação / pilates / personalizado / não definida]
INSISTÊNCIAS DE VALOR: [número de vezes que pediu preço — use o valor do CONTEXTO ADICIONAL]
OBJEÇÕES JÁ LEVANTADAS: [lista, ou "nenhuma"]
NÍVEL DE ENGAJAMENTO: [alto / médio / baixo]
INFOS PESSOAIS RELEVANTES: [3 frases curtas no máximo, sobre rotina/contexto/dor/medo]
HISTÓRICO DE TENTATIVAS DE FECHAMENTO: [resumo curto: o que foi proposto, o que ele respondeu]
PRÓXIMA AÇÃO RECOMENDADA: [1 frase clara]

NÃO INVENTE. Se faltar info pra um campo, escreva "não declarado" ou "—".`;

  const response = await haiku.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 700,
    messages: [{ role: 'user', content: prompt }],
  });

  let text = response.content?.[0]?.text?.trim() || '';
  if (text.length > MAX_RESUMO_CHARS) text = text.slice(0, MAX_RESUMO_CHARS);

  // Sanity check de schema. Se Haiku retornou texto malformado (não segue
  // formato esperado), descarta e deixa próximo trigger tentar de novo.
  if (!validateResumoSchema(text)) {
    console.warn(`[resumo-dinamico] retorno do Haiku falhou no sanity check (${text.length} chars, <${MIN_SECOES_VALIDAS} seções válidas) — descartando`);
    return '';
  }
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
    // Passa state pro Haiku ter acesso a insistencias_valor + objecoes_levantadas
    // confiáveis (vêm do backend, não do parsing impreciso do transcript).
    const resumo = await gerarResumo(allMsgs, contact?.name, state);
    if (!resumo) {
      return { updated: false, reason: 'Haiku retornou vazio ou falhou sanity check', totalMsgs };
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
// Header "CONTEXTO PRÉVIO" segue Anexo 5 / Seção 4 do doc mestre.
function buildResumoBlock(state) {
  if (!state?.resumo_dinamico) return '';
  return `═══ CONTEXTO PRÉVIO (resumo das primeiras ${state.resumo_dinamico_n_msgs || 0} msgs desta conversa) ═══\n\n${state.resumo_dinamico}\n\n(Abaixo seguem as últimas mensagens na íntegra.)`;
}

module.exports = {
  shouldUpdateResumo,
  gerarResumo,
  validateResumoSchema,
  updateResumoDinamicoBackground,
  buildResumoBlock,
  formatTranscript,
  stripTags,
  TRIGGER_THRESHOLD,
  UPDATE_EVERY_N_MSGS,
  MAX_RESUMO_CHARS,
  RESUMO_SECOES,
  MIN_SECOES_VALIDAS,
};
