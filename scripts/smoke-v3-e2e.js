#!/usr/bin/env node
// Smoke single-turn end-to-end do PR1 da migração v3.
// Roda 1 chamada Anthropic real com input simulado, sem persistir DB.
// Imprime: input do lead, raw tool_input, parsed convertido, mensagem_ao_lead, métricas.
// Custo esperado: ~$0.02 USD (Sonnet 4.5, prompt v2 cacheado + tool definition + 1 turn).

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

(async () => {
  const userMessage = 'oi qual valor?';

  // Estado inicial: lead novo. Backend já incrementaria insistencias_valor=1
  // pelo regex detector (texto contém "valor"). Reproduzimos isso aqui.
  const baseState = {
    estagio_atual: 'qualificacao_inicial',
    insistencias_valor: 0,
    objecoes_levantadas: [],
    tentativas_objecao_atual: 0,
  };
  const state = {
    ...baseState,
    insistencias_valor: computeInsistenciasValor(baseState.insistencias_valor, userMessage),
  };

  const moduleNames = routeModules({ state, text: userMessage });
  const { dynamicCtx } = buildDynamicContextV3({
    isFirstMessage: true,
    isReturning: false,
    daysSinceLast: null,
    isAudio: false,
  });
  const systemBlocks = buildSystemBlocks({ state, moduleNames, dynamicCtx, resumoBlock: '' });

  const client = new Anthropic({ apiKey: config.anthropic.apiKey });
  const t0 = Date.now();
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    system: systemBlocks,
    messages: [{ role: 'user', content: userMessage }],
    tools: [buildToolDefinition()],
    tool_choice: { type: 'tool', name: TOOL_NAME, disable_parallel_tool_use: true },
  });
  const latencyMs = Date.now() - t0;

  const toolBlocks = findAllToolUseBlocks(response);
  const rawInput = extractToolInput(response);
  const parsed = toolInputToParsed(rawInput);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  SMOKE V3 — single turn end-to-end');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('━━━ INPUT DO LEAD ━━━');
  console.log(JSON.stringify(userMessage));
  console.log('\nstate inicial: insistencias_valor =', baseState.insistencias_valor);
  console.log('state pós auto-incremento backend: insistencias_valor =', state.insistencias_valor);
  console.log('módulos roteados:', moduleNames);

  console.log('\n━━━ TOOL_INPUT (RAW — direto do Sonnet) ━━━');
  console.log(JSON.stringify(rawInput, null, 2));

  console.log('\n━━━ PARSED (convertido pra formato compat com computeStateUpdate v2) ━━━');
  console.log('stateFields:    ', JSON.stringify(parsed.stateFields, null, 2));
  console.log('nameFromTag:    ', JSON.stringify(parsed.nameFromTag));
  console.log('requiredModule: ', JSON.stringify(parsed.requiredModule));
  console.log('agendamento:    ', JSON.stringify(parsed.agendamento));
  console.log('useAudio:       ', parsed.useAudio);
  console.log('askingForAudio: ', parsed.askingForAudio);

  console.log('\n━━━ MENSAGEM_AO_LEAD (texto que iria pro WhatsApp) ━━━');
  console.log(parsed.cleanText);

  console.log('\n━━━ MÉTRICAS ━━━');
  console.log('latency:           ', latencyMs, 'ms');
  console.log('tokensInput:       ', response.usage?.input_tokens || 0);
  console.log('tokensOutput:      ', response.usage?.output_tokens || 0);
  console.log('cacheRead:         ', response.usage?.cache_read_input_tokens || 0);
  console.log('cacheCreation:     ', response.usage?.cache_creation_input_tokens || 0);
  console.log('stop_reason:       ', response.stop_reason);
  console.log('content blocks:    ', response.content.map(b => b.type).join(', '));
  console.log('tool_use blocks:   ', toolBlocks.length, '(canário OK se === 1)');

  const cost = (
    (response.usage.input_tokens - (response.usage.cache_read_input_tokens || 0)) * 3 / 1_000_000 +
    (response.usage.cache_read_input_tokens || 0) * 0.30 / 1_000_000 +
    response.usage.output_tokens * 15 / 1_000_000
  );
  console.log('estimatedCost:     $' + cost.toFixed(4), '(~R$' + (cost * 5.5).toFixed(4) + ')');

  console.log('\n━━━ ASSERTS PRÉ-MERGE ━━━');
  const checks = [
    ['toolCallPresent (rawInput não-null)', rawInput !== null],
    ['exatamente 1 tool_use block (canário não dispara)', toolBlocks.length === 1],
    ['stateFields tem estagio_atual', parsed.stateFields && typeof parsed.stateFields.estagio_atual === 'string'],
    ['mensagem_ao_lead não vazia', parsed.cleanText && parsed.cleanText.length > 0],
    ['mensagem sem tags v2 (sem [ESTADO:])', !/\[ESTADO:/i.test(parsed.cleanText)],
    ['mensagem sem em-dash', !/—|–/.test(parsed.cleanText)],
    ['stop_reason === "tool_use" (modelo terminou com chamada)', response.stop_reason === 'tool_use'],
  ];
  for (const [label, ok] of checks) {
    console.log((ok ? '  ✓' : '  ✗'), label);
  }
  const allPass = checks.every(c => c[1]);
  console.log('\n' + (allPass ? '✅ SMOKE PASS' : '❌ SMOKE FAIL — ver asserts acima'));
  console.log('═══════════════════════════════════════════════════════════\n');
  process.exit(allPass ? 0 : 1);
})().catch(err => {
  console.error('\n❌ SMOKE ERROR:', err.message);
  if (err.stack) console.error(err.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
});
