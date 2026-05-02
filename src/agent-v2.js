// ═══════════════════════════════════════════════════════════════
// AGENT V2 — Johnny modular (núcleo + módulos sob demanda)
// ═══════════════════════════════════════════════════════════════
//
// Implementação das Fases 0, 1, 2 e 3 do plano de refatoração v2:
// - Parser de [ESTADO:...] e [MODULO_REQUERIDO:nome|nenhum]
// - Detector regex de pedido de valor (auto-incremento backend)
// - Montador de prompt em camadas (núcleo cacheado + KB cacheada + estado + módulo + resumo + dyn ctx)
// - Roteador de módulos determinístico (router-v2.js) — decide quais módulos
//   carregar dinamicamente baseado em estado + keywords no texto do lead
// - Resumo dinâmico (resumo-dinamico.js) — comprime histórico longo via Haiku
//   4.5 em background; conversas com 20+ msgs usam (resumo + msgs novas) em
//   vez de 50 msgs cheias. Fire-and-forget após responder.
// - replyV2() paralelo ao reply() v1; ativa via AGENT_VERSION=v2

const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');
const db = require('./db');
const NUCLEO_V2 = require('./prompt-nucleo-v2');
const { routeModules } = require('./router-v2');
const {
  buildResumoBlock,
  updateResumoDinamicoBackground,
} = require('./resumo-dinamico');

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

// ═══════════════════════════════════════════════════════════════
// REGEX DETECTOR DE PEDIDO DE VALOR
// ═══════════════════════════════════════════════════════════════

const VALOR_KW = /\b(valor(?:es)?|pre[çc]o|pre[çc]os|mensalidade(?:s)?|investimento|barato|caro|tabela|or[çc]amento|custa(?:m)?|cobra(?:m)?)\b/i;
const QUANTO_FRASE = /\b(quanto|qto)\s+(custa|fica|[ée]|sai|cobra|pago|paga|d[áa])/i;

const NEGATIVE_PATTERNS = [
  /valor\s+(d[ao]|de\s+)\s*(experi[êe]ncia|amizade|pessoa|alma|tempo)/i,
  /(d[ãa]o|d[ãa]r|valoriza|valorizam)\s+valor/i,
  /tabela\s+de\s+(treino|exerc[íi]cios|alimenta[çc][ãa]o|h[áa]bitos)/i,
];

function detectsValueRequest(text) {
  if (!text) return false;
  for (const r of NEGATIVE_PATTERNS) if (r.test(text)) return false;
  return VALOR_KW.test(text) || QUANTO_FRASE.test(text);
}

// ═══════════════════════════════════════════════════════════════
// PARSERS DE TAGS
// ═══════════════════════════════════════════════════════════════

// Extrai pares "campo=valor" separados por "|" do corpo de uma tag.
// Aceita valores vazios ("nome=|outra=X").
function parsePipeKV(body) {
  const out = {};
  if (!body) return out;
  const parts = body.split('|');
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    const key = p.slice(0, eq).trim();
    const val = p.slice(eq + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

// Mapeia campos da tag [ESTADO:...] pros nomes de coluna do lead_state
const ESTADO_KEY_MAP = {
  estagio: 'estagio_atual',
  proxima_acao: 'proxima_acao',
  insistencias_valor: 'insistencias_valor',
  objetivo: 'objetivo',
  nome: '_nome', // não vai pro lead_state — vai pro contacts.name
  modalidade: 'modalidade_recomendada',
  disponibilidade: 'disponibilidade',
  objecao_ativa: 'objecao_ativa',
};

// Parse + remoção de tags em uma resposta da IA.
// Retorna { stateFields, requiredModule, agendamento, cleanText }.
function parseAndStripTags(answer) {
  const result = {
    stateFields: null,
    nameFromTag: null,
    requiredModule: null,
    agendamento: null,
    cleanText: answer,
  };

  // [ESTADO:...] (case-insensitive, position-agnostic — strip mesmo se vier no fim)
  const estadoMatch = answer.match(/\[ESTADO:([^\]]+)\]/i);
  if (estadoMatch) {
    const fields = parsePipeKV(estadoMatch[1]);
    const dbFields = {};
    for (const [tagKey, val] of Object.entries(fields)) {
      const dbKey = ESTADO_KEY_MAP[tagKey];
      if (!dbKey) continue;
      if (dbKey === '_nome') {
        if (val) result.nameFromTag = val;
        continue;
      }
      // insistencias_valor é numérico
      if (dbKey === 'insistencias_valor') {
        const n = parseInt(val, 10);
        if (!isNaN(n)) dbFields[dbKey] = Math.max(0, Math.min(3, n));
        continue;
      }
      dbFields[dbKey] = val;
    }
    result.stateFields = dbFields;
    result.cleanText = result.cleanText.replace(/\[ESTADO:[^\]]+\]\s*\n?/gi, '');
  }

  // [MODULO_REQUERIDO:nome|nenhum]
  const moduloMatch = answer.match(/\[MODULO_REQUERIDO:([^\]]+)\]/i);
  if (moduloMatch) {
    const name = moduloMatch[1].trim().toLowerCase();
    result.requiredModule = (name === 'nenhum' || !name) ? null : name;
    result.cleanText = result.cleanText.replace(/\[MODULO_REQUERIDO:[^\]]+\]\s*\n?/gi, '');
  }

  // [AGENDAMENTO:nome=X|dia=Y|hora=Z|modalidade=W] (compat com v1)
  const agMatch = answer.match(/\[AGENDAMENTO:([^\]]+)\]/i);
  if (agMatch) {
    result.agendamento = parsePipeKV(agMatch[1]);
    result.cleanText = result.cleanText.replace(/\[AGENDAMENTO:[^\]]+\]\s*\n?/gi, '');
  }

  result.cleanText = result.cleanText.trim();
  return result;
}

// ═══════════════════════════════════════════════════════════════
// MONTADOR DE PROMPT EM CAMADAS
// ═══════════════════════════════════════════════════════════════

// Constrói o bloco "ESTADO_ATUAL_DA_CONVERSA" pra injetar no prompt.
// Curto (~300-500 chars). Sem cache (varia por lead+turno).
function buildStateBlock(state) {
  if (!state) return '';
  const parts = [
    `═══ ESTADO ATUAL DESTA CONVERSA ═══`,
    `- Estágio: ${state.estagio_atual || 'qualificacao_inicial'}`,
  ];
  if (state.objetivo) parts.push(`- Objetivo declarado: ${state.objetivo}`);
  if (state.modalidade_recomendada) parts.push(`- Modalidade recomendada: ${state.modalidade_recomendada}`);
  if (state.disponibilidade) parts.push(`- Disponibilidade: ${state.disponibilidade}`);
  parts.push(`- Insistências de valor (lead pediu preço): ${state.insistencias_valor || 0}/3`);
  if (state.objecao_ativa) {
    parts.push(`- Objeção ativa: ${state.objecao_ativa}`);
    parts.push(`- Tentativas nesta objeção: ${state.tentativas_objecao_atual || 0}/3 (em 3 vai pra handoff)`);
  }
  if (Array.isArray(state.objecoes_levantadas) && state.objecoes_levantadas.length) {
    parts.push(`- Objeções já levantadas no histórico: ${state.objecoes_levantadas.join(', ')}`);
  }
  if (state.aula_experimental_agendada) {
    parts.push(`- Aula experimental: AGENDADA (${state.data_agendamento || '?'} às ${state.hora_agendamento || '?'})`);
  }
  return parts.join('\n');
}

// Constrói o bloco do(s) módulo(s) carregado(s).
// Na Fase 2 o Roteador (router-v2.js) decide quais carregar.
function buildModulesBlock(moduleNames) {
  if (!moduleNames || !moduleNames.length) return '';
  const rows = db.getPromptModuleContents(moduleNames);
  if (!rows.length) return '';
  let out = '\n\n═══ MÓDULOS CARREGADOS ═══\n';
  for (const m of rows) {
    out += `\n────── ${m.title || m.name} ──────\n${m.content}\n`;
  }
  return out;
}

// Monta sistema da chamada Claude em camadas com cache control.
// Ordem (importante pra cache hit): núcleo → kb → estado → módulos → resumo → dynamic ctx
function buildSystemBlocks({ state, moduleNames, dynamicCtx, resumoBlock }) {
  const blocks = [
    // Camada 1: Núcleo estático (~12.5k chars). CACHEADO.
    { type: 'text', text: NUCLEO_V2, cache_control: { type: 'ephemeral' } },
  ];

  // Camada 2: Knowledge base (planos atuais, horários, promo). CACHEADO (raramente muda).
  const kb = db.buildAcademiaInfoBlock();
  if (kb && kb.trim()) {
    blocks.push({ type: 'text', text: kb, cache_control: { type: 'ephemeral' } });
  }

  // Camada 3: Estado do lead (varia por turno). SEM CACHE.
  const stateBlock = buildStateBlock(state);
  if (stateBlock) blocks.push({ type: 'text', text: stateBlock });

  // Camada 4: Módulos carregados. SEM CACHE (varia por turno).
  const modBlock = buildModulesBlock(moduleNames);
  if (modBlock) blocks.push({ type: 'text', text: modBlock });

  // Camada 4.5: Resumo dinâmico das mensagens antigas (Fase 3). SEM CACHE.
  // Só presente se conversa atingiu TRIGGER_THRESHOLD e Haiku já gerou um resumo.
  if (resumoBlock && resumoBlock.trim()) blocks.push({ type: 'text', text: resumoBlock });

  // Camada 5: Sinais dinâmicos (primeiro turno, fora horário, retornando, áudio). SEM CACHE.
  if (dynamicCtx && dynamicCtx.trim()) blocks.push({ type: 'text', text: dynamicCtx });

  return blocks;
}

// ═══════════════════════════════════════════════════════════════
// SIGNAL DETECTORS — montagem do dynamicCtx (compat com v1)
// ═══════════════════════════════════════════════════════════════

function isOutsideBusinessHours() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0=dom, 1-5=seg-sex, 6=sab
  if (day === 0) return true; // domingo fechado
  if (day >= 1 && day <= 5) return hour < 6 || hour >= 22;
  if (day === 6) return hour < 9 || hour >= 13;
  return false;
}

function buildDynamicContext({ state, isFirstMessage, isReturning, daysSinceLast, isAudio }) {
  let ctx = '';
  const tagsAtivas = [];

  if (isFirstMessage) {
    ctx += '\n\n[PRIMEIRO_TURNO] — esta é a primeira mensagem dessa conversa. Aplique a Regra 1 das Regras de Ouro à risca: máximo 2 linhas, saudação + 1 binária. PROIBIDO listar valor, horário, endereço, plano, modalidade ou estrutura.';
    tagsAtivas.push('[PRIMEIRO_TURNO]');
  }
  if (isOutsideBusinessHours() && isFirstMessage) {
    ctx += '\n\n[FORA_DO_HORÁRIO_COMERCIAL] — esse lead mandou mensagem fora do horário de funcionamento. Considere mencionar que é assistente virtual no abrir.';
    tagsAtivas.push('[FORA_DO_HORÁRIO_COMERCIAL]');
  }
  if (isReturning) {
    ctx += `\n\n[LEAD_RETORNANDO_APÓS_${daysSinceLast}_DIAS] — esse lead já conversou contigo há ${daysSinceLast} dias. Reconheça o retorno com zero julgamento. NÃO comece do zero.`;
    tagsAtivas.push(`[LEAD_RETORNANDO_APÓS_${daysSinceLast}_DIAS]`);
  }
  if (isAudio) {
    ctx += '\n\n[LEAD_RESPONDEU_EM_AUDIO] — Lead te mandou áudio. Espelhe o meio: comece sua resposta com [AUDIO] no PRIMEIRO caractere.';
    tagsAtivas.push('[LEAD_RESPONDEU_EM_AUDIO]');
  }

  return { dynamicCtx: ctx, tagsAtivas };
}

// ═══════════════════════════════════════════════════════════════
// LÓGICA COMPARTILHADA — replyV2 e simulateReplyV2 chamam
// ═══════════════════════════════════════════════════════════════

// Auto-incremento backend de insistencias_valor (regex determinístico).
// Pure: retorna o novo valor (clampado 0-3) sem mutar o input.
function computeInsistenciasValor(currentInsist, userText) {
  const cur = currentInsist || 0;
  if (cur >= 3) return cur;
  if (detectsValueRequest(userText)) return cur + 1;
  return cur;
}

// Aplica o resultado do parser num estado e retorna { stateFields, appendedObjecao }.
// Pure: NÃO faz I/O. Quem chama decide como persistir (DB ou memória).
// - Detecta mudança de objeção → reseta tentativas_objecao_atual=0, sinaliza appendedObjecao
// - Mesma objeção → tentativas_objecao_atual+=1, força handoff_humano em 3
function computeStateUpdate(currentState, parsed) {
  if (!parsed.stateFields) {
    return { stateFields: null, appendedObjecao: null };
  }
  const stateFields = { ...parsed.stateFields };
  let appendedObjecao = null;

  const newObj = stateFields.objecao_ativa;
  if (newObj && newObj !== currentState.objecao_ativa) {
    stateFields.tentativas_objecao_atual = 0;
    appendedObjecao = newObj;
  } else if (newObj && newObj === currentState.objecao_ativa) {
    const next = (currentState.tentativas_objecao_atual || 0) + 1;
    stateFields.tentativas_objecao_atual = Math.min(3, next);
    if (next >= 3) stateFields.estagio_atual = 'handoff_humano';
  }
  return { stateFields, appendedObjecao };
}

// ═══════════════════════════════════════════════════════════════
// REPLY V2 — função principal
// ═══════════════════════════════════════════════════════════════

async function replyV2(from, text, { isAudio = false } = {}) {
  // 1. Garante contato + lead_state
  db.getOrCreateContact(from);
  const state = db.getOrCreateLeadState(from);

  // 2. Detecta sinais (tags de sistema)
  const messageCountBefore = db.getMessageCount(from);
  const isFirstMessage = messageCountBefore === 0;
  const daysSinceLast = db.getDaysSinceLastContact(from);
  const isReturning = daysSinceLast !== null && daysSinceLast >= 30;

  // 3. Auto-incremento backend de insistencias_valor (regex determinístico)
  const newInsist = computeInsistenciasValor(state.insistencias_valor, text);
  if (newInsist !== (state.insistencias_valor || 0)) {
    db.incrementLeadStateCounter(from, 'insistencias_valor', 1, 3);
  }

  // 4. Salva mensagem do lead no histórico
  db.addMessage(from, 'user', text, isAudio);
  db.updateLastContact(from);
  db.incrementLeadStateCounter(from, 'total_mensagens_lead', 1);

  // 5. Re-lê estado pós-incremento
  const stateNow = db.getLeadState(from);

  // 6. Módulos a carregar — Roteador determinístico (Fase 2)
  // Combina: modulo_pendente (tag manual do turno anterior) + estado + keywords no texto.
  const moduleNames = routeModules({
    state: stateNow,
    text,
    modulo_pendente: stateNow.modulo_pendente,
  });

  // 7. Monta dynamic context
  const { dynamicCtx, tagsAtivas } = buildDynamicContext({
    state: stateNow, isFirstMessage, isReturning, daysSinceLast, isAudio,
  });
  if (tagsAtivas.length) {
    db.updateLeadState(from, { tags_sistema_ativas: tagsAtivas });
  }

  // 8. Histórico — Fase 3 (Anexo 5/Seção 4): se já tem resumo, prompt usa
  // resumo_dinamico + ÚLTIMAS 10 mensagens (fixas). Senão, carrega 50 últimas.
  let history;
  let resumoBlock = '';
  if (stateNow.resumo_dinamico && (stateNow.resumo_dinamico_n_msgs || 0) > 0) {
    history = db.getHistory(from, 10);
    resumoBlock = buildResumoBlock(stateNow);
  } else {
    history = db.getHistory(from, 50);
  }

  // 9. Monta system blocks em camadas (resumoBlock só vai se preenchido)
  const systemBlocks = buildSystemBlocks({
    state: stateNow,
    moduleNames,
    dynamicCtx,
    resumoBlock,
  });

  // 10. Chama Claude
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    system: systemBlocks,
    messages: history,
  });

  let answer = response.content?.[0]?.text || '';

  // 11. Parseia tags + remove do texto
  const parsed = parseAndStripTags(answer);
  let cleanText = parsed.cleanText;

  // Detecta [AUDIO] (compat com v1 — vem ANTES das tags ESTADO/MODULO em alguns casos)
  const useAudio = /\[AUDIO\]/i.test(cleanText);
  cleanText = cleanText.replace(/\[AUDIO\]\s*/gi, '').trim();
  cleanText = cleanText.replace(/\[PEDIR_AUDIO\]\s*/gi, '').trim();

  // Sanitiza em-dash que o modelo insiste em usar
  cleanText = cleanText.replace(/\s*[—–]\s*/g, ', ');

  // 12. Atualiza lead_state com campos extraídos da tag [ESTADO]
  const { stateFields: nextFields, appendedObjecao } = computeStateUpdate(stateNow, parsed);
  if (appendedObjecao) db.appendObjecaoLevantada(from, appendedObjecao);
  if (nextFields) db.updateLeadState(from, nextFields);

  // Nome capturado na tag → atualiza contacts.name (não em lead_state)
  if (parsed.nameFromTag && parsed.nameFromTag !== '') {
    try { db.setContactName(from, parsed.nameFromTag); } catch {}
  }

  // 13. Módulo requerido pra próximo turno (se Johnny pediu)
  if (parsed.requiredModule) {
    db.updateLeadState(from, { modulo_pendente: parsed.requiredModule });
  } else if (moduleNames.length) {
    // Consumiu o pendente — limpa
    db.updateLeadState(from, { modulo_pendente: null });
  }

  // 14. Salva resposta da IA no histórico
  db.addMessage(from, 'assistant', cleanText, useAudio);
  db.incrementLeadStateCounter(from, 'total_mensagens_johnny', 1);

  console.log(`[agent-v2] ${from} estagio=${stateNow.estagio_atual} insist=${stateNow.insistencias_valor} mod=${moduleNames.join(',') || 'nenhum'} → "${cleanText.slice(0, 60)}..."`);

  // 15. Resumo dinâmico (Fase 3) — fire-and-forget. Não bloqueia a resposta.
  // Se conversa atingiu threshold, gera/atualiza o resumo via Haiku em background.
  // Próximo turno usará o resumo no lugar do histórico longo.
  updateResumoDinamicoBackground(from).catch(err => {
    console.error('[agent-v2] erro no resumo background:', err.message);
  });

  return {
    text: cleanText,
    useAudio,
    askingForAudio: /\[PEDIR_AUDIO\]/i.test(answer),
    state: db.getLeadState(from),
    parsed,
    agendamento: parsed.agendamento,
  };
}

// ═══════════════════════════════════════════════════════════════
// SIMULATE V2 — playground (não toca DB)
// ═══════════════════════════════════════════════════════════════

async function simulateReplyV2(history, userMessage, simulatedState = null) {
  const baseState = simulatedState || {
    estagio_atual: 'qualificacao_inicial',
    insistencias_valor: 0,
    objecoes_levantadas: [],
    tentativas_objecao_atual: 0,
  };
  // Garante objecoes_levantadas como array (pode vir null/undefined do cliente)
  if (!Array.isArray(baseState.objecoes_levantadas)) baseState.objecoes_levantadas = [];

  // Auto-incremento backend de insistencias_valor (paridade com replyV2)
  const state = {
    ...baseState,
    insistencias_valor: computeInsistenciasValor(baseState.insistencias_valor, userMessage),
  };

  const { dynamicCtx } = buildDynamicContext({
    state, isFirstMessage: history.length === 0, isReturning: false, daysSinceLast: null, isAudio: false,
  });

  const moduleNames = routeModules({
    state,
    text: userMessage,
    modulo_pendente: state.modulo_pendente,
  });
  // Fase 3: se state simulado tem resumo_dinamico, injeta no prompt (paridade com replyV2).
  // Playground não persiste; o cliente pode passar resumo simulado pra testar fluxo.
  const resumoBlock = state.resumo_dinamico ? buildResumoBlock(state) : '';
  const systemBlocks = buildSystemBlocks({ state, moduleNames, dynamicCtx, resumoBlock });

  const cleanHistory = (history || [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-50)
    .map(m => ({ role: m.role, content: m.content }));
  cleanHistory.push({ role: 'user', content: userMessage });

  const t0 = Date.now();
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    system: systemBlocks,
    messages: cleanHistory,
  });
  const latencyMs = Date.now() - t0;

  let answer = response.content?.[0]?.text || '';
  const parsed = parseAndStripTags(answer);
  let cleanText = parsed.cleanText;
  cleanText = cleanText.replace(/\[AUDIO\]\s*/gi, '').replace(/\[PEDIR_AUDIO\]\s*/gi, '').trim();
  cleanText = cleanText.replace(/\s*[—–]\s*/g, ', ');

  // Atualiza state simulado em memória (paridade com replyV2 — mesma lógica de mudança de objeção)
  const { stateFields, appendedObjecao } = computeStateUpdate(state, parsed);
  const nextState = { ...state, ...(stateFields || {}) };
  if (appendedObjecao && !state.objecoes_levantadas.includes(appendedObjecao)) {
    nextState.objecoes_levantadas = [...state.objecoes_levantadas, appendedObjecao];
  }
  if (parsed.requiredModule) nextState.modulo_pendente = parsed.requiredModule;
  else if (state.modulo_pendente) nextState.modulo_pendente = null;

  return {
    text: cleanText,
    state: nextState,
    parsed,
    tokensInput: response.usage?.input_tokens || 0,
    tokensOutput: response.usage?.output_tokens || 0,
    cacheReadTokens: response.usage?.cache_read_input_tokens || 0,
    cacheCreationTokens: response.usage?.cache_creation_input_tokens || 0,
    latencyMs,
  };
}

module.exports = {
  replyV2,
  simulateReplyV2,
  // exportados pra testes
  detectsValueRequest,
  parsePipeKV,
  parseAndStripTags,
  buildStateBlock,
  buildSystemBlocks,
  computeInsistenciasValor,
  computeStateUpdate,
};
