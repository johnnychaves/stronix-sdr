// ═══════════════════════════════════════════════════════════════
// AGENT V3 — Tool use forçado (Anthropic structured output)
// ═══════════════════════════════════════════════════════════════
//
// PR1 da migração v3: caminho paralelo a replyV2, mesma máquina de estado,
// mesmo roteador, mesmo resumo dinâmico, mesmos detectors. A ÚNICA diferença
// é que o canal de saída do estado + mensagem deixa de ser tags em texto livre
// (`[ESTADO:...]`, etc.) e passa a ser uma ferramenta forçada via
// `tool_choice: { type: "tool", name: "responder_ao_lead" }`.
//
// Resolve por construção:
//   - tag esquecida (60-80% nas baterias E.1/E.2_EXT do v2) → impossível, API
//     não termina sem chamada da tool.
//   - estado + mensagem desalinhados → atomico, mesmo input.
//
// Reuso de v2: buildSystemBlocks, computeStateUpdate, computeInsistenciasValor.
// Re-implementação local: buildDynamicContext + isOutsideBusinessHours
// (pra manter v2 100% intocado durante a janela de validação v3).

const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');
const db = require('./db');
const {
  buildSystemBlocks,
  computeInsistenciasValor,
  computeStateUpdate,
  detectsValueRequest,
} = require('./agent-v2');
const { routeModules } = require('./router-v2');
const {
  buildResumoBlock,
  updateResumoDinamicoBackground,
} = require('./resumo-dinamico');
const {
  detectsPrecoInventado,
  extractPrecosOficiais,
  detectsValorAntecipado,
} = require('./v2-detectors');
const {
  TOOL_NAME,
  buildToolDefinition,
  findAllToolUseBlocks,
  extractToolInput,
  extractToolUseId,
  toolInputToParsed,
  ADDENDUM_V3,
} = require('./v3-tools');
const {
  getPlanosCanonicos,
  validatePrecosNaMensagem,
  buildRetryHint,
} = require('./v3-validators');

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

// Modelo: mesmo do v2 — Sonnet 4.5. Decisão do dono: isolar a variável estrutura
// (tool use) da variável modelo. Sonnet 4.6 fica pra avaliação pós-PR4.
const MODEL = 'claude-sonnet-4-5-20250929';

// ─────────────────────────────────────────────────────────────────────
// HELPERS LOCAIS — re-implementação minimalista pra não tocar agent-v2.js
// (que está em modo manutenção durante a janela de validação v3).
//
// ⚠️ DÍVIDA TÉCNICA: isOutsideBusinessHours e buildDynamicContextV3 são
// duplicação das funções equivalentes em src/agent-v2.js (linhas 231 e 241).
// Se uma mudar (ex: novo horário comercial, nova tag de sistema), a outra
// PRECISA mudar junto — senão o comportamento divergirá entre v2 e v3.
//
// Cleanup planejado em PR pós-PR4: extrair pra src/agent-shared.js
// (single source of truth) e ambos importam. Aceito agora pra preservar
// v2 100% intocado durante a janela de validação v3.
// ─────────────────────────────────────────────────────────────────────

function isOutsideBusinessHours() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  if (day === 0) return true;
  if (day >= 1 && day <= 5) return hour < 6 || hour >= 22;
  if (day === 6) return hour < 9 || hour >= 13;
  return false;
}

// Reproduz exatamente o buildDynamicContext do agent-v2.js. PREPENDA o ADDENDUM_V3
// no início pra que o modelo receba a instrução de tool use junto com os sinais
// dinâmicos (ambos não-cacheados, ambos pequenos — overhead aceitável por turno).
function buildDynamicContextV3({ isFirstMessage, isReturning, daysSinceLast, isAudio }) {
  let ctx = ADDENDUM_V3;
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
    ctx += '\n\n[LEAD_RESPONDEU_EM_AUDIO] — Lead te mandou áudio. Espelhe o meio: marque `responder_em_audio: true` na tool.';
    tagsAtivas.push('[LEAD_RESPONDEU_EM_AUDIO]');
  }
  return { dynamicCtx: ctx, tagsAtivas };
}

// ─────────────────────────────────────────────────────────────────────
// GERAÇÃO COM VALIDAÇÃO DE PREÇO — call + validate + 1 retry máximo
//
// PR2: depois da call inicial, valida que cada R$ na mensagem bate ±5%
// com o preço oficial dos plano_ids referenciados. Se inválido, retry via
// `tool_result` (is_error=true) com hint corretivo + tabela de preços.
// Se segundo retry também falhar: log + envia resposta original (call 1).
//
// Side effect: loga PRECO_FORA_REFERENCIA_V3 e RETRY_V3 quando aciona.
// `fromPhone` pode ser null em playground/simulate — eventos viram log
// orfão de phone, mas continuam contabilizados pelo Monitor.
// ─────────────────────────────────────────────────────────────────────

// Soma usage de 1 ou 2 responses Anthropic (call 1 + call 2 quando há retry).
// Pra Monitor calcular custo agregado por turno.
function aggUsage(...responses) {
  return responses.reduce((acc, r) => {
    if (!r || !r.usage) return acc;
    acc.tokensInput += r.usage.input_tokens || 0;
    acc.tokensOutput += r.usage.output_tokens || 0;
    acc.cacheReadTokens += r.usage.cache_read_input_tokens || 0;
    acc.cacheCreationTokens += r.usage.cache_creation_input_tokens || 0;
    return acc;
  }, { tokensInput: 0, tokensOutput: 0, cacheReadTokens: 0, cacheCreationTokens: 0 });
}

async function generateAndValidate(callOptions, fromPhone) {
  const planoPrecos = getPlanosCanonicos();

  // Call 1 ──────────────────────────────────────
  const r1 = await client.messages.create(callOptions);

  // Canário: 2+ blocos tool_use violam contrato Anthropic com disable_parallel_tool_use=true.
  const tool1Blocks = findAllToolUseBlocks(r1);
  if (tool1Blocks.length > 1) {
    db.logV2Event(db.V2_EVENT_TYPES.TOOL_CALL_MULTIPLE, fromPhone, null, {
      count: tool1Blocks.length,
      stop_reason: r1.stop_reason,
      attempt: 1,
    });
  }

  const tool1Input = extractToolInput(r1);
  if (!tool1Input) {
    return {
      response: r1,
      finalToolInput: null,
      validation: null,
      retried: false,
      retrySucceeded: false,
      planoPrecos,
      usage: aggUsage(r1),
    };
  }

  const v1 = validatePrecosNaMensagem({
    mensagem: tool1Input.mensagem_ao_lead || '',
    planosReferenciados: tool1Input.planos_referenciados || [],
    planoPrecos,
  });

  if (v1.valid) {
    return {
      response: r1,
      finalToolInput: tool1Input,
      validation: v1,
      retried: false,
      retrySucceeded: false,
      planoPrecos,
      usage: aggUsage(r1),
    };
  }

  // Call 1 reprovou ──────────────────────────────
  db.logV2Event(db.V2_EVENT_TYPES.PRECO_FORA_REFERENCIA_V3, fromPhone, null, {
    attempt: 1,
    reason: v1.reason,
    valores: v1.valoresEncontrados,
    referenciados: v1.referenciados,
    mismatches: (v1.mismatches || []).slice(0, 3),
    preview: (tool1Input.mensagem_ao_lead || '').slice(0, 100),
  });

  // Build messages pro retry: histórico + assistant response (com tool_use) + tool_result (error)
  const tool1Id = extractToolUseId(r1);
  if (!tool1Id) {
    // Sem ID, não consigo fazer retry idiomático. Devolve call 1 como original.
    return {
      response: r1, finalToolInput: tool1Input, validation: v1,
      retried: false, retrySucceeded: false, planoPrecos,
      usage: aggUsage(r1),
    };
  }

  const retryMessages = [
    ...(callOptions.messages || []),
    { role: 'assistant', content: r1.content },
    {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: tool1Id,
        content: buildRetryHint(v1, planoPrecos),
        is_error: true,
      }],
    },
  ];

  db.logV2Event(db.V2_EVENT_TYPES.RETRY_V3, fromPhone, null, { trigger: v1.reason });

  // Call 2 (retry) ──────────────────────────────
  const r2 = await client.messages.create({ ...callOptions, messages: retryMessages });

  const tool2Blocks = findAllToolUseBlocks(r2);
  if (tool2Blocks.length > 1) {
    db.logV2Event(db.V2_EVENT_TYPES.TOOL_CALL_MULTIPLE, fromPhone, null, {
      count: tool2Blocks.length, stop_reason: r2.stop_reason, attempt: 2,
    });
  }

  const tool2Input = extractToolInput(r2);
  if (!tool2Input) {
    // Retry sem tool_use — fallback pra call 1
    db.logV2Event(db.V2_EVENT_TYPES.PRECO_FORA_REFERENCIA_V3, fromPhone, null, {
      attempt: 2, reason: 'tool_call_ausente_no_retry', using_original: true,
    });
    return {
      response: r1, finalToolInput: tool1Input, validation: v1,
      retried: true, retrySucceeded: false, planoPrecos,
      usage: aggUsage(r1, r2),
    };
  }

  const v2 = validatePrecosNaMensagem({
    mensagem: tool2Input.mensagem_ao_lead || '',
    planosReferenciados: tool2Input.planos_referenciados || [],
    planoPrecos,
  });

  if (v2.valid) {
    return {
      response: r2, finalToolInput: tool2Input, validation: v2,
      retried: true, retrySucceeded: true, planoPrecos,
      usage: aggUsage(r1, r2),
    };
  }

  // Call 2 também reprovou — log e envia resposta ORIGINAL (call 1)
  db.logV2Event(db.V2_EVENT_TYPES.PRECO_FORA_REFERENCIA_V3, fromPhone, null, {
    attempt: 2,
    reason: v2.reason,
    valores: v2.valoresEncontrados,
    mismatches: (v2.mismatches || []).slice(0, 3),
    using_original: true,
  });
  return {
    response: r1, finalToolInput: tool1Input, validation: v1,
    retried: true, retrySucceeded: false, planoPrecos,
    usage: aggUsage(r1, r2),
  };
}

// ─────────────────────────────────────────────────────────────────────
// REPLY V3 — função principal (paralelo a replyV2)
// ─────────────────────────────────────────────────────────────────────

async function replyV3(from, text, { isAudio = false } = {}) {
  try {
    return await replyV3Inner(from, text, { isAudio });
  } catch (err) {
    db.logV2Event(db.V2_EVENT_TYPES.CRASH, from, null, {
      message: err.message,
      stack: err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : null,
      version: 'v3',
    });
    throw err;
  }
}

async function replyV3Inner(from, text, { isAudio = false } = {}) {
  // 1. Garante contato + lead_state
  db.getOrCreateContact(from);
  const state = db.getOrCreateLeadState(from);

  // 2. Sinais
  const messageCountBefore = db.getMessageCount(from);
  const isFirstMessage = messageCountBefore === 0;
  const daysSinceLast = db.getDaysSinceLastContact(from);
  const isReturning = daysSinceLast !== null && daysSinceLast >= 30;

  // 3. Auto-incremento backend de insistencias_valor
  const newInsist = computeInsistenciasValor(state.insistencias_valor, text);
  if (newInsist !== (state.insistencias_valor || 0)) {
    db.incrementLeadStateCounter(from, 'insistencias_valor', 1, 3);
  }

  // 4. Persiste msg do lead
  db.addMessage(from, 'user', text, isAudio);
  db.updateLastContact(from);
  db.incrementLeadStateCounter(from, 'total_mensagens_lead', 1);

  // 5. Re-lê estado pós-incremento
  const stateNow = db.getLeadState(from);

  // 6. Roteador determinístico (mesmo do v2)
  const moduleNames = routeModules({
    state: stateNow,
    text,
    modulo_pendente: stateNow.modulo_pendente,
  });
  if (!moduleNames.length) {
    db.logV2Event(db.V2_EVENT_TYPES.ROUTER_EMPTY, from, null, { text: text?.slice(0, 100), version: 'v3' });
  }

  // 7. Dynamic context (com ADDENDUM_V3 prependado)
  const { dynamicCtx, tagsAtivas } = buildDynamicContextV3({
    isFirstMessage, isReturning, daysSinceLast, isAudio,
  });
  if (tagsAtivas.length) {
    db.updateLeadState(from, { tags_sistema_ativas: tagsAtivas });
  }

  // 8. Histórico (com resumo dinâmico se disponível — Fase 3 reusada)
  let history;
  let resumoBlock = '';
  if (stateNow.resumo_dinamico && (stateNow.resumo_dinamico_n_msgs || 0) > 0) {
    history = db.getHistory(from, 10);
    resumoBlock = buildResumoBlock(stateNow);
  } else {
    history = db.getHistory(from, 50);
  }

  // 9. System blocks (reusa buildSystemBlocks do v2 — núcleo + KB cacheados)
  const systemBlocks = buildSystemBlocks({
    state: stateNow,
    moduleNames,
    dynamicCtx,
    resumoBlock,
  });

  // 10. Chama Claude com tool use forçado + validação de preço cruzada (PR2).
  // Plano IDs vêm do parser dinâmico do módulo planos_e_precos no DB.
  const planoPrecos = getPlanosCanonicos();
  const planoIds = Object.keys(planoPrecos);
  const callOptions = {
    model: MODEL,
    max_tokens: 1024,
    system: systemBlocks,
    messages: history,
    tools: [buildToolDefinition({ planoIds })],
    tool_choice: { type: 'tool', name: TOOL_NAME, disable_parallel_tool_use: true },
  };

  const {
    response,
    finalToolInput: toolInput,
    validation,
    retried,
    retrySucceeded,
    usage,
  } = await generateAndValidate(callOptions, from);

  // 11. Sanity: response sem tool_use block. Não deveria com tool_choice forçado.
  if (!toolInput) {
    db.logV2Event(db.V2_EVENT_TYPES.TOOL_CALL_AUSENTE, from, null, {
      stop_reason: response.stop_reason,
      content_types: (response.content || []).map(b => b?.type).join(','),
      ...(usage || {}),
    });
    const fallback = 'Opa, deu ruim aqui do meu lado. Pode repetir?';
    db.addMessage(from, 'assistant', fallback, false);
    db.incrementLeadStateCounter(from, 'total_mensagens_johnny', 1);
    return {
      text: fallback,
      useAudio: false,
      askingForAudio: false,
      state: db.getLeadState(from),
      parsed: null,
      agendamento: null,
    };
  }

  const parsed = toolInputToParsed(toolInput);
  const cleanText = parsed.cleanText;
  const useAudio = parsed.useAudio;

  // 12. Aplica state machine (mesma lógica do v2 — computeStateUpdate)
  const { stateFields: nextFields, appendedObjecao } = computeStateUpdate(stateNow, parsed);
  if (appendedObjecao) db.appendObjecaoLevantada(from, appendedObjecao);
  if (nextFields) db.updateLeadState(from, nextFields);

  // Nome capturado → contacts.name
  if (parsed.nameFromTag) {
    try {
      db.setContactName(from, parsed.nameFromTag);
      try { require('./events').emitLeadsChanged(); } catch {}
    } catch {}
  }

  // 13. Módulo pendente do próximo turno
  if (parsed.requiredModule) {
    db.updateLeadState(from, { modulo_pendente: parsed.requiredModule });
  } else if (moduleNames.length) {
    db.updateLeadState(from, { modulo_pendente: null });
  }

  // 14. Persiste resposta da IA
  db.addMessage(from, 'assistant', cleanText, useAudio);
  db.incrementLeadStateCounter(from, 'total_mensagens_johnny', 1);

  console.log(`[agent-v3] ${from} estagio=${stateNow.estagio_atual} insist=${stateNow.insistencias_valor} mod=${moduleNames.join(',') || 'nenhum'} retried=${retried} → "${cleanText.slice(0, 60)}..."`);

  // 15. Instrumentação — tag esquecida não acontece em v3 (tool forçada),
  // mas registramos TURN_OK_V3 pra Monitor diferenciar tráfego v2 × v3.
  // detectsPrecoInventado e detectsValorAntecipado continuam rodando como
  // defesa em profundidade — devem triggar perto de 0% em v3 dado o PR2
  // (validação por enum + retry). Quando triggerarem indica que validador
  // deixou passar — sinal pra revisar regras.
  // PR3: meta inclui tokens (agregados de r1+r2 quando há retry) pra cálculo
  // de custo no Monitor. Custo histórico anterior ao merge não tem esses
  // campos — getCostMetrics filtra meta.tokensInput presente.
  const turnOkMeta = { ...(usage || {}) };
  if (retried) { turnOkMeta.retried = true; turnOkMeta.retrySucceeded = retrySucceeded; }
  db.logV2Event(db.V2_EVENT_TYPES.TURN_OK_V3, from, null, turnOkMeta);
  try {
    const valorCheck = detectsValorAntecipado(cleanText, stateNow.insistencias_valor);
    if (valorCheck.triggered) {
      db.logV2Event(db.V2_EVENT_TYPES.VALOR_ANTECIPADO, from, null, { ...valorCheck.context, version: 'v3' });
    }
    const precosOficiais = extractPrecosOficiais({
      academiaInfoMap: db.getAcademiaInfoMap(),
      promptModules: db.getAllPromptModules(),
    });
    const precoCheck = detectsPrecoInventado(cleanText, precosOficiais);
    if (precoCheck.triggered) {
      db.logV2Event(db.V2_EVENT_TYPES.PRECO_INVENTADO, from, null, { ...precoCheck.context, version: 'v3' });
    }
  } catch (e) {
    console.warn('[agent-v3] detector falhou:', e.message);
  }

  // 16. Resumo dinâmico em background (Fase 3 — Haiku 4.5 fire-and-forget)
  updateResumoDinamicoBackground(from).catch(err => {
    console.error('[agent-v3] erro no resumo background:', err.message);
  });

  return {
    text: cleanText,
    useAudio,
    askingForAudio: parsed.askingForAudio,
    state: db.getLeadState(from),
    parsed,
    agendamento: parsed.agendamento,
  };
}

// ─────────────────────────────────────────────────────────────────────
// SIMULATE V3 — playground (não toca DB, paridade com simulateReplyV2)
// ─────────────────────────────────────────────────────────────────────

async function simulateReplyV3(history, userMessage, simulatedState = null) {
  const baseState = simulatedState || {
    estagio_atual: 'qualificacao_inicial',
    insistencias_valor: 0,
    objecoes_levantadas: [],
    tentativas_objecao_atual: 0,
  };
  if (!Array.isArray(baseState.objecoes_levantadas)) baseState.objecoes_levantadas = [];

  const state = {
    ...baseState,
    insistencias_valor: computeInsistenciasValor(baseState.insistencias_valor, userMessage),
  };

  const { dynamicCtx } = buildDynamicContextV3({
    isFirstMessage: history.length === 0,
    isReturning: false,
    daysSinceLast: null,
    isAudio: false,
  });

  const moduleNames = routeModules({
    state, text: userMessage, modulo_pendente: state.modulo_pendente,
  });
  const resumoBlock = state.resumo_dinamico ? buildResumoBlock(state) : '';
  const systemBlocks = buildSystemBlocks({ state, moduleNames, dynamicCtx, resumoBlock });

  const cleanHistory = (history || [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-50)
    .map(m => ({ role: m.role, content: m.content }));
  cleanHistory.push({ role: 'user', content: userMessage });

  // Mesmo fluxo do replyV3: validação de preço + 1 retry. Em playground não
  // persistimos eventos no DB (fromPhone=null faz logV2Event escrever sem
  // phone — admin pode ainda inspecionar), mas a logica é idêntica.
  const planoPrecos = getPlanosCanonicos();
  const planoIds = Object.keys(planoPrecos);
  const callOptions = {
    model: MODEL,
    max_tokens: 1024,
    system: systemBlocks,
    messages: cleanHistory,
    tools: [buildToolDefinition({ planoIds })],
    tool_choice: { type: 'tool', name: TOOL_NAME, disable_parallel_tool_use: true },
  };

  const t0 = Date.now();
  const {
    response,
    finalToolInput: toolInput,
    validation,
    retried,
    retrySucceeded,
  } = await generateAndValidate(callOptions, null);
  const latencyMs = Date.now() - t0;

  const parsed = toolInputToParsed(toolInput);
  const cleanText = parsed.cleanText;

  // Atualiza state simulado em memória (paridade com simulateReplyV2)
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
    toolCallPresent: toolInput !== null,
    rawToolInput: toolInput,
    // PR2: dono pode ver no playground se o validator aprovou direto, retry corrigiu, ou ambos falharam
    precoValidation: validation ? {
      valid: validation.valid,
      reason: validation.reason || null,
      mismatches: validation.mismatches || [],
      referenciados: validation.referenciados || [],
    } : null,
    retried,
    retrySucceeded,
    tokensInput: response.usage?.input_tokens || 0,
    tokensOutput: response.usage?.output_tokens || 0,
    cacheReadTokens: response.usage?.cache_read_input_tokens || 0,
    cacheCreationTokens: response.usage?.cache_creation_input_tokens || 0,
    latencyMs,
  };
}

module.exports = {
  replyV3,
  simulateReplyV3,
  // exportados pra testes / debug
  buildDynamicContextV3,
  isOutsideBusinessHours,
};
