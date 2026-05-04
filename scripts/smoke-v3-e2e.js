#!/usr/bin/env node
// Smoke single-turn end-to-end do PR1+PR2 da migração v3.
// Roda 2 cenários reais contra Anthropic, sem persistir DB:
//   1. "oi qual valor?" — defletor de pedido de valor (PR1, sem preço na mensagem)
//   2. estagio=apresentacao_planos com insistencias_valor=3 — força bot a citar
//      preço, valida planos_referenciados + cruzamento com tabela oficial (PR2)
//
// Custo esperado: ~$0.02-0.05 USD total (2 turns Sonnet 4.5).

const Anthropic = require('@anthropic-ai/sdk');
const config = require('../src/config');
const { buildSystemBlocks, computeInsistenciasValor } = require('../src/agent-v2');
const { routeModules } = require('../src/router-v2');
const {
  buildToolDefinition,
  findAllToolUseBlocks,
  extractToolInput,
  toolInputToParsed,
  TOOL_NAME,
} = require('../src/v3-tools');
const { buildDynamicContextV3 } = require('../src/agent-v3');
const { getPlanosCanonicos, validatePrecosNaMensagem } = require('../src/v3-validators');

const client = new Anthropic({ apiKey: config.anthropic.apiKey });
const MODEL = 'claude-sonnet-4-5-20250929';

async function runScenario({ titulo, userMessage, baseState, history = [] }) {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(' ', titulo);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('━━━ INPUT DO LEAD ━━━');
  console.log(JSON.stringify(userMessage));

  const state = {
    ...baseState,
    insistencias_valor: computeInsistenciasValor(baseState.insistencias_valor || 0, userMessage),
  };

  const moduleNames = routeModules({ state, text: userMessage });
  const { dynamicCtx } = buildDynamicContextV3({
    isFirstMessage: history.length === 0,
    isReturning: false,
    daysSinceLast: null,
    isAudio: false,
  });
  const systemBlocks = buildSystemBlocks({ state, moduleNames, dynamicCtx, resumoBlock: '' });

  const planoPrecos = getPlanosCanonicos();
  const planoIds = Object.keys(planoPrecos);

  console.log('\n━━━ STATE INICIAL ━━━');
  console.log('estagio:', state.estagio_atual, '| insistencias_valor:', state.insistencias_valor);
  console.log('módulos roteados:', moduleNames.length ? moduleNames : '(vazio — fallback núcleo+KB)');
  console.log('plano_ids no schema (do parser):', planoIds.length, planoIds.length ? `(${planoIds.slice(0, 4).join(',')}...)` : '');

  const cleanHistory = history.map(m => ({ role: m.role, content: m.content }));
  cleanHistory.push({ role: 'user', content: userMessage });

  const t0 = Date.now();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemBlocks,
    messages: cleanHistory,
    tools: [buildToolDefinition({ planoIds })],
    tool_choice: { type: 'tool', name: TOOL_NAME, disable_parallel_tool_use: true },
  });
  const latencyMs = Date.now() - t0;

  const toolBlocks = findAllToolUseBlocks(response);
  const rawInput = extractToolInput(response);
  const parsed = toolInputToParsed(rawInput);

  const validation = validatePrecosNaMensagem({
    mensagem: rawInput?.mensagem_ao_lead || '',
    planosReferenciados: rawInput?.planos_referenciados || [],
    planoPrecos,
  });

  console.log('\n━━━ TOOL_INPUT (RAW) ━━━');
  console.log(JSON.stringify(rawInput, null, 2));

  console.log('\n━━━ MENSAGEM_AO_LEAD ━━━');
  console.log(parsed.cleanText);

  console.log('\n━━━ VALIDAÇÃO DE PREÇO ━━━');
  console.log('valid:', validation.valid);
  if (!validation.valid) {
    console.log('reason:', validation.reason);
    console.log('mismatches:', JSON.stringify(validation.mismatches, null, 2));
  }
  console.log('referenciados:', JSON.stringify(rawInput?.planos_referenciados || []));
  console.log('valoresEncontrados (≥R$50):', validation.valoresEncontrados);

  console.log('\n━━━ MÉTRICAS ━━━');
  console.log('latency:', latencyMs, 'ms');
  console.log('tokensInput:', response.usage?.input_tokens || 0);
  console.log('tokensOutput:', response.usage?.output_tokens || 0);
  console.log('cacheRead:', response.usage?.cache_read_input_tokens || 0);
  console.log('cacheCreation:', response.usage?.cache_creation_input_tokens || 0);
  console.log('stop_reason:', response.stop_reason);
  console.log('tool_use blocks:', toolBlocks.length);

  // Pricing Sonnet 4.5: input $3/M, cache_creation $3.75/M, cache_read $0.30/M, output $15/M.
  // input_tokens é o non-cached input (separado de cache_read/cache_creation), NÃO subtrair.
  const u = response.usage;
  const cost = (
    (u.input_tokens || 0) * 3 / 1_000_000 +
    (u.cache_creation_input_tokens || 0) * 3.75 / 1_000_000 +
    (u.cache_read_input_tokens || 0) * 0.30 / 1_000_000 +
    (u.output_tokens || 0) * 15 / 1_000_000
  );
  console.log('estimatedCost: $' + cost.toFixed(4));

  return { response, rawInput, parsed, validation, toolBlocks, cost };
}

(async () => {
  // Cenário 1: PR1 baseline — defletor de valor sem citar preço
  const c1 = await runScenario({
    titulo: 'CENÁRIO 1 (PR1): "oi qual valor?" — defletor sem preço',
    userMessage: 'oi qual valor?',
    baseState: { estagio_atual: 'qualificacao_inicial', insistencias_valor: 0 },
  });

  console.log('\n━━━ ASSERTS CENÁRIO 1 ━━━');
  const c1checks = [
    ['toolCallPresent', c1.rawInput !== null],
    ['exatamente 1 tool_use (canário)', c1.toolBlocks.length === 1],
    ['stop_reason = tool_use', c1.response.stop_reason === 'tool_use'],
    ['mensagem sem [ESTADO:]', !/\[ESTADO:/i.test(c1.parsed.cleanText)],
    ['validação aprovou (defletor não cita R$)', c1.validation.valid === true],
    ['planos_referenciados vazio (não citou R$)', (c1.rawInput.planos_referenciados || []).length === 0],
  ];
  for (const [l, ok] of c1checks) console.log((ok ? '  ✓' : '  ✗'), l);

  // Cenário 2: PR2 — força apresentação de planos
  // Pré-requisito do módulo: estagio=apresentacao_planos + insistencias_valor=3
  const c2 = await runScenario({
    titulo: 'CENÁRIO 2 (PR2): apresentacao_planos com insist=3 — força citação de preço',
    userMessage: 'beleza, me passa os valores então',
    baseState: {
      estagio_atual: 'apresentacao_planos',
      insistencias_valor: 3,
      objetivo: 'qualidade_vida',
      modalidade_recomendada: 'musculacao',
    },
    history: [
      { role: 'user', content: 'oi' },
      { role: 'assistant', content: 'Opa beleza! Sou o Johnny da STRONIX. Tu tá treinando ou parado?' },
      { role: 'user', content: 'parado' },
      { role: 'assistant', content: 'Massa. Mais resultado físico ou qualidade de vida?' },
      { role: 'user', content: 'qualidade de vida' },
      { role: 'assistant', content: 'Show. Como é teu nome?' },
      { role: 'user', content: 'João' },
      { role: 'assistant', content: 'Pra ti tô indicando musculação, treino completo. Tu treina manhã ou final do dia?' },
      { role: 'user', content: 'manhã' },
      { role: 'assistant', content: 'Posso te encaixar terça ou quarta?' },
      { role: 'user', content: 'qual o valor?' },
      { role: 'assistant', content: 'Já te passo, antes vamos confirmar o horário?' },
      { role: 'user', content: 'me passa os valores primeiro' },
    ],
  });

  console.log('\n━━━ ASSERTS CENÁRIO 2 ━━━');
  const c2checks = [
    ['toolCallPresent', c2.rawInput !== null],
    ['exatamente 1 tool_use', c2.toolBlocks.length === 1],
    ['mensagem citou pelo menos 1 valor ≥R$50', c2.validation.valoresEncontrados.length > 0],
    ['planos_referenciados não-vazio (PR2 obrigatório)', (c2.rawInput.planos_referenciados || []).length > 0],
    ['validação aprovou (preços batem com plano referenciado ±5%)', c2.validation.valid === true],
  ];
  for (const [l, ok] of c2checks) console.log((ok ? '  ✓' : '  ✗'), l);

  const totalCost = c1.cost + c2.cost;
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  RESUMO: custo total = $' + totalCost.toFixed(4), `(~R$${(totalCost * 5.5).toFixed(4)})`);
  console.log('═══════════════════════════════════════════════════════════');

  const allPass = [...c1checks, ...c2checks].every(c => c[1]);
  console.log(allPass ? '\n✅ SMOKE PASS (2/2 cenários)' : '\n❌ SMOKE FAIL — ver asserts acima');
  process.exit(allPass ? 0 : 1);
})().catch(err => {
  console.error('\n❌ SMOKE ERROR:', err.message);
  if (err.stack) console.error(err.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
});
