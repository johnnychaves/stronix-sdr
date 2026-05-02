// ═══════════════════════════════════════════════════════════════
// AGENT V2 — Johnny modular (núcleo + módulos sob demanda)
// ═══════════════════════════════════════════════════════════════
//
// Implementação da Fase 0+1 do plano de refatoração v2:
// - Parser de [ESTADO:...] e [MODULO_REQUERIDO:nome|nenhum]
// - Detector regex de pedido de valor (auto-incremento backend)
// - Montador de prompt em camadas (núcleo cacheado + KB cacheada + estado + módulo + dyn ctx)
// - replyV2() paralelo ao reply() v1; ativa via AGENT_VERSION=v2
//
// SEM Roteador ainda (Fase 2 — PR #33). Por enquanto carrega APENAS o
// módulo declarado em lead_state.modulo_pendente (fallback do turno
// anterior). Demais módulos: inacessíveis, IA responde com "deixa eu
// confirmar com a equipe" — comportamento intencional desta fase.

const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');
const db = require('./db');
const NUCLEO_V2 = require('./prompt-nucleo-v2');

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
// Na Fase 0+1: só carrega o modulo_pendente (do turno anterior).
// Na Fase 2: o Roteador decide quais carregar.
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
// Ordem (importante pra cache hit): núcleo → kb → estado → módulos → dynamic ctx
function buildSystemBlocks({ state, moduleNames, dynamicCtx }) {
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
  if (detectsValueRequest(text) && (state.insistencias_valor || 0) < 3) {
    db.incrementLeadStateCounter(from, 'insistencias_valor', 1, 3);
  }

  // 4. Salva mensagem do lead no histórico
  db.addMessage(from, 'user', text, isAudio);
  db.updateLastContact(from);
  db.incrementLeadStateCounter(from, 'total_mensagens_lead', 1);

  // 5. Re-lê estado pós-incremento
  const stateNow = db.getLeadState(from);

  // 6. Módulo a carregar — SÓ o pendente do turno anterior (Fase 0+1, sem Roteador)
  const moduleNames = [];
  if (stateNow.modulo_pendente) {
    moduleNames.push(stateNow.modulo_pendente);
  }

  // 7. Monta dynamic context
  const { dynamicCtx, tagsAtivas } = buildDynamicContext({
    state: stateNow, isFirstMessage, isReturning, daysSinceLast, isAudio,
  });
  if (tagsAtivas.length) {
    db.updateLeadState(from, { tags_sistema_ativas: tagsAtivas });
  }

  // 8. Histórico (últimas 50 — Fase 3 troca por resumo+10)
  const history = db.getHistory(from, 50);

  // 9. Monta system blocks em camadas
  const systemBlocks = buildSystemBlocks({
    state: stateNow,
    moduleNames,
    dynamicCtx,
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
  if (parsed.stateFields) {
    // Detecta mudança de objeção pra resetar contador
    const newObj = parsed.stateFields.objecao_ativa;
    if (newObj && newObj !== stateNow.objecao_ativa) {
      parsed.stateFields.tentativas_objecao_atual = 0;
      // Append no histórico de objeções
      db.appendObjecaoLevantada(from, newObj);
    } else if (newObj && newObj === stateNow.objecao_ativa) {
      // Mesma objeção da rodada anterior → +1 tentativa
      const next = (stateNow.tentativas_objecao_atual || 0) + 1;
      parsed.stateFields.tentativas_objecao_atual = Math.min(3, next);
      // Em 3, força handoff
      if (next >= 3) {
        parsed.stateFields.estagio_atual = 'handoff_humano';
      }
    }
    db.updateLeadState(from, parsed.stateFields);
  }

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
  const state = simulatedState || {
    estagio_atual: 'qualificacao_inicial',
    insistencias_valor: 0,
    objecoes_levantadas: [],
    tentativas_objecao_atual: 0,
  };

  const { dynamicCtx } = buildDynamicContext({
    state, isFirstMessage: history.length === 0, isReturning: false, daysSinceLast: null, isAudio: false,
  });

  const moduleNames = state.modulo_pendente ? [state.modulo_pendente] : [];
  const systemBlocks = buildSystemBlocks({ state, moduleNames, dynamicCtx });

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

  // Atualiza state simulado em memória (não persiste)
  const nextState = { ...state, ...(parsed.stateFields || {}) };
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
};
