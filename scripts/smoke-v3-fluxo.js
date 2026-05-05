#!/usr/bin/env node
// Smoke v3 — guardas de fluxo (Regra 1 + Regra 2 do ADDENDUM_V3).
//
// Bug original (relatado pelo dono no playground v3):
//   Lead respondeu pergunta de qualificação ("Seria no final do dia mesmo");
//   agente apresentou planos com valores + propôs visita na MESMA mensagem;
//   frase "sobre os valores que tu pediu" foi inventada.
//
// Hipótese: prompt v2 mandando no comportamento de fluxo, ADDENDUM_V3 antigo
// não cobre regras de fluxo (só estrutura tool use). Modelo pula etapas da
// máquina de estado.
//
// Fix: ADDENDUM_V3 ganha 2 regras explícitas (REGRA 1 — valor só em
// apresentacao_planos / objecao_preco / já-citado-antes; REGRA 2 — uma ação
// por turno COM exceção única da virada apresentar+visita do módulo
// planos_e_precos).
//
// Smoke (6 cenários):
//   1-5: lead responde qualificação SEM pedir valor → resposta NÃO pode
//        conter R$ nem palavra "plano" em contexto de preço.
//   6: lead pede valor 3x consecutivas (insistencias_valor 0→3) → na 3ª,
//      apresentacao_planos COM valores corretos + virada obrigatória.
//      Valida não-regressão da exceção da regra 2.
//
// Custo esperado: ~$0.06 USD (8 calls Sonnet 4.5 com cache hit no system).
//
// Rodar:
//   ANTHROPIC_API_KEY=... node scripts/smoke-v3-fluxo.js

const path = require('path');
const fs = require('fs');

// DB temp pra não sujar produção/dev. Antes de require de qualquer src/.
const tmpDb = path.join(require('os').tmpdir(), `smoke-v3-fluxo-${process.pid}.sqlite`);
process.env.DB_PATH = tmpDb;
process.on('exit', () => { try { fs.unlinkSync(tmpDb); } catch (_) {} });

const { simulateReplyV3 } = require('../src/agent-v3');

let pass = 0, fail = 0;
const failures = [];
const allResults = [];
let totalCost = 0;
let totalLatency = 0;

const PRICING = { input: 3, output: 15, cacheRead: 0.30, cacheCreation: 3.75 };
function calcCost(r) {
  return ((r.tokensInput || 0) * PRICING.input
        + (r.tokensOutput || 0) * PRICING.output
        + (r.cacheReadTokens || 0) * PRICING.cacheRead
        + (r.cacheCreationTokens || 0) * PRICING.cacheCreation) / 1_000_000;
}

function ok(msg) { pass++; console.log(`    ✅ ${msg}`); }
function fx(msg) { fail++; failures.push(msg); console.log(`    ❌ ${msg}`); }

function hasMonetaryValue(text) {
  return /R\$\s*\d/.test(text);
}
function endsAsking(text) {
  // "qual plano faz mais sentido pra você" e variações
  return /qual\s+plano\s+(faz|seria|é)\s+(mais\s+)?sentido/i.test(text)
      || /qual\s+(deles|opcao|opção|você prefere)/i.test(text);
}
function hasViradaPraVisita(text) {
  // Frase de virada obrigatória do módulo planos_e_precos.
  // Aceita variantes do agente: "antes de fechar", "vale conhecer", "primeira aula",
  // "posso te encaixar", "aula experimental", "conhecer pessoalmente", etc.
  return /\b(antes\s+de\s+fechar|conhecer\s+pessoalmente|primeira\s+aula|aula\s+(experimental|gratuita)|encaixar|visita|conhecer\s+a\s+academia)\b/i.test(text);
}

async function runScenario(label, fn) {
  console.log(`\n━━━ ${label} ━━━`);
  try {
    await fn();
  } catch (e) {
    fx(`exceção: ${e.message}`);
  }
}

(async () => {
  console.log(`\n[smoke-v3-fluxo] iniciando — DB temp: ${tmpDb}\n`);

  // ─── Cenário 1 ────────────────────────────────────────────────────────
  await runScenario('Cenário 1 — "Tô parado faz tempo" (resposta da binária treinando)', async () => {
    const history = [
      { role: 'assistant', content: 'Opa beleza! Sou o Johnny da STRONIX 👋 Tu tá treinando ou parado?' },
    ];
    const state = { estagio_atual: 'qualificacao_inicial', insistencias_valor: 0 };
    const r = await simulateReplyV3(history, 'Tô parado faz tempo', state);
    totalCost += calcCost(r); totalLatency += r.latencyMs;
    console.log(`  Resposta: "${r.text}"`);
    console.log(`  estagio: ${r.state?.estagio_atual} | insist: ${r.state?.insistencias_valor}`);
    allResults.push({ cenario: 1, lead: 'Tô parado faz tempo', resposta: r.text, state: r.state });
    if (!hasMonetaryValue(r.text)) ok('NÃO citou R$'); else fx('citou R$ inesperadamente');
    if (r.text.length > 0) ok('respondeu (não vazio)'); else fx('resposta vazia');
  });

  // ─── Cenário 2 ────────────────────────────────────────────────────────
  await runScenario('Cenário 2 — "Quero emagrecer" (resposta de objetivo)', async () => {
    const history = [
      { role: 'assistant', content: 'Opa beleza! Sou o Johnny da STRONIX 👋 Tu tá treinando ou parado?' },
      { role: 'user', content: 'Tô parado' },
      { role: 'assistant', content: 'Beleza. Mais resultado físico ou mais qualidade de vida no dia a dia?' },
      { role: 'user', content: 'Resultado físico' },
      { role: 'assistant', content: 'Bah, ganhar massa ou emagrecer?' },
    ];
    const state = { estagio_atual: 'qualificacao_objetivo', insistencias_valor: 0 };
    const r = await simulateReplyV3(history, 'Quero emagrecer', state);
    totalCost += calcCost(r); totalLatency += r.latencyMs;
    console.log(`  Resposta: "${r.text}"`);
    console.log(`  estagio: ${r.state?.estagio_atual} | insist: ${r.state?.insistencias_valor}`);
    allResults.push({ cenario: 2, lead: 'Quero emagrecer', resposta: r.text, state: r.state });
    if (!hasMonetaryValue(r.text)) ok('NÃO citou R$'); else fx('citou R$ inesperadamente');
  });

  // ─── Cenário 3 ────────────────────────────────────────────────────────
  await runScenario('Cenário 3 — "Maria" (captura de nome)', async () => {
    const history = [
      { role: 'assistant', content: 'Opa beleza! Sou o Johnny da STRONIX 👋 Tu tá treinando ou parado?' },
      { role: 'user', content: 'Parado' },
      { role: 'assistant', content: 'Mais resultado físico ou qualidade de vida?' },
      { role: 'user', content: 'Resultado' },
      { role: 'assistant', content: 'Ganhar massa ou emagrecer?' },
      { role: 'user', content: 'Emagrecer' },
      { role: 'assistant', content: 'A propósito, como é teu nome?' },
    ];
    const state = { estagio_atual: 'captura_nome', objetivo: 'emagrecer', insistencias_valor: 0 };
    const r = await simulateReplyV3(history, 'Maria', state);
    totalCost += calcCost(r); totalLatency += r.latencyMs;
    console.log(`  Resposta: "${r.text}"`);
    console.log(`  estagio: ${r.state?.estagio_atual} | insist: ${r.state?.insistencias_valor}`);
    allResults.push({ cenario: 3, lead: 'Maria', resposta: r.text, state: r.state });
    if (!hasMonetaryValue(r.text)) ok('NÃO citou R$'); else fx('citou R$ inesperadamente');
  });

  // ─── Cenário 4 — BUG ORIGINAL DO DONO ─────────────────────────────────
  await runScenario('Cenário 4 — "Seria no final do dia mesmo" (BUG ORIGINAL — qualificação de turno)', async () => {
    const history = [
      { role: 'assistant', content: 'Opa beleza! Sou o Johnny da STRONIX 👋 Tu tá treinando ou parado?' },
      { role: 'user', content: 'Tô parado' },
      { role: 'assistant', content: 'Mais resultado físico ou qualidade de vida?' },
      { role: 'user', content: 'Resultado' },
      { role: 'assistant', content: 'Ganhar massa ou emagrecer?' },
      { role: 'user', content: 'Emagrecer' },
      { role: 'assistant', content: 'A propósito, como é teu nome?' },
      { role: 'user', content: 'Maria' },
      { role: 'assistant', content: 'Bah Maria, manhã ou final do dia?' },
    ];
    const state = { estagio_atual: 'recomendacao_modalidade', objetivo: 'emagrecer', insistencias_valor: 0 };
    const r = await simulateReplyV3(history, 'Seria no final do dia mesmo', state);
    totalCost += calcCost(r); totalLatency += r.latencyMs;
    console.log(`  Resposta: "${r.text}"`);
    console.log(`  estagio: ${r.state?.estagio_atual} | insist: ${r.state?.insistencias_valor}`);
    allResults.push({ cenario: 4, lead: 'Seria no final do dia mesmo', resposta: r.text, state: r.state });
    if (!hasMonetaryValue(r.text)) ok('NÃO citou R$ (REGRA 1 atendida — bug original NÃO reproduziu)'); else fx('CITOU R$ — bug ORIGINAL reproduziu, regra 1 NÃO funcionou');
    if (!/sobre\s+os\s+valores?\s+que\s+tu\s+pediu/i.test(r.text)) ok('NÃO inventou "sobre os valores que tu pediu"'); else fx('INVENTOU frase do bug original');
  });

  // ─── Cenário 5 ────────────────────────────────────────────────────────
  await runScenario('Cenário 5 — "Terça pode ser" (drill de dia)', async () => {
    const history = [
      { role: 'assistant', content: 'Opa beleza! Sou o Johnny da STRONIX 👋 Tu tá treinando ou parado?' },
      { role: 'user', content: 'Parado' },
      { role: 'assistant', content: 'Resultado físico ou qualidade de vida?' },
      { role: 'user', content: 'Resultado' },
      { role: 'assistant', content: 'Ganhar massa ou emagrecer?' },
      { role: 'user', content: 'Emagrecer' },
      { role: 'assistant', content: 'A propósito, como é teu nome?' },
      { role: 'user', content: 'Maria' },
      { role: 'assistant', content: 'Bah Maria, manhã ou final do dia?' },
      { role: 'user', content: 'Final do dia' },
      { role: 'assistant', content: 'Posso te encaixar terça ou quarta, qual rola pra ti?' },
    ];
    const state = { estagio_atual: 'proposta_visita', objetivo: 'emagrecer', disponibilidade: 'tarde', insistencias_valor: 0 };
    const r = await simulateReplyV3(history, 'Terça pode ser', state);
    totalCost += calcCost(r); totalLatency += r.latencyMs;
    console.log(`  Resposta: "${r.text}"`);
    console.log(`  estagio: ${r.state?.estagio_atual} | insist: ${r.state?.insistencias_valor}`);
    allResults.push({ cenario: 5, lead: 'Terça pode ser', resposta: r.text, state: r.state });
    if (!hasMonetaryValue(r.text)) ok('NÃO citou R$ (Regra 1)'); else fx('citou R$ inesperadamente');
    // Aceita qualquer hora exata (8h..16h, com ou sem minutos): 9h, 14h, 15h30, etc.
    // Módulo fluxo_aula_experimental define faixas Manhã/Almoço/Início-tarde (8h-16h).
    if (/\b\d{1,2}h(?:\d{2})?\b/i.test(r.text) || /\bhoras?\b/i.test(r.text)) ok('avançou pro drill de hora exata');
    else fx('não avançou pro drill de hora exata');
  });

  // ─── Cenário 6 — VIRADA OBRIGATÓRIA (não-regressão da regra 2) ────────
  await runScenario('Cenário 6 — Lead pede valor 3x → apresentação + virada obrigatória', async () => {
    let cumHistory = [];
    let cumState = { estagio_atual: 'qualificacao_inicial', insistencias_valor: 0 };

    // Turno 1: lead pede valor pela 1ª vez. computeInsistenciasValor incrementa pra 1.
    cumHistory.push({ role: 'assistant', content: 'Opa beleza! Sou o Johnny da STRONIX 👋 Tu tá treinando ou parado?' });
    let r1 = await simulateReplyV3(cumHistory, 'qual valor', cumState);
    totalCost += calcCost(r1); totalLatency += r1.latencyMs;
    console.log(`  [Turno 1] insist=${cumState.insistencias_valor}→${r1.state?.insistencias_valor}, estagio=${r1.state?.estagio_atual}`);
    console.log(`    Resposta: "${r1.text}"`);
    cumHistory.push({ role: 'user', content: 'qual valor' });
    cumHistory.push({ role: 'assistant', content: r1.text });
    cumState = r1.state;

    // Turno 2: lead pede pela 2ª vez. insistencias 1→2.
    let r2 = await simulateReplyV3(cumHistory, 'mas qual o preço?', cumState);
    totalCost += calcCost(r2); totalLatency += r2.latencyMs;
    console.log(`  [Turno 2] insist=${cumState.insistencias_valor}→${r2.state?.insistencias_valor}, estagio=${r2.state?.estagio_atual}`);
    console.log(`    Resposta: "${r2.text}"`);
    cumHistory.push({ role: 'user', content: 'mas qual o preço?' });
    cumHistory.push({ role: 'assistant', content: r2.text });
    cumState = r2.state;

    // Turno 3: lead pede pela 3ª vez. insistencias 2→3 → trigger de apresentacao_planos.
    let r3 = await simulateReplyV3(cumHistory, 'tô só querendo saber valor', cumState);
    totalCost += calcCost(r3); totalLatency += r3.latencyMs;
    console.log(`  [Turno 3] insist=${cumState.insistencias_valor}→${r3.state?.insistencias_valor}, estagio=${r3.state?.estagio_atual}`);
    console.log(`    Resposta:\n      "${r3.text}"`);
    console.log(`    planos_referenciados: ${JSON.stringify(r3.parsed?.planosReferenciados || [])}`);
    console.log(`    precoValidation: ${JSON.stringify(r3.precoValidation)}`);
    allResults.push({ cenario: 6, turno: 3, lead: 'tô só querendo saber valor', resposta: r3.text, state: r3.state, planos: r3.parsed?.planosReferenciados });

    // Validações no turno 3 (apresentação)
    if (r3.state?.insistencias_valor === 3) ok('insistencias_valor chegou a 3'); else fx(`insistencias_valor=${r3.state?.insistencias_valor}, esperado 3`);

    const valoresEsperados = ['199', '149', '109'];
    const found = valoresEsperados.filter(v => new RegExp(`R\\$\\s*${v}`).test(r3.text));
    if (found.length >= 2) ok(`citou pelo menos 2 dos 3 valores musc esperados (${found.join(', ')})`);
    else fx(`citou só ${found.length} valor(es): ${found.join(', ')}, esperado >=2 de [199, 149, 109]`);

    if (hasViradaPraVisita(r3.text)) ok('contém frase de virada pra aula experimental (REGRA 2 EXCEÇÃO atendida)');
    else fx('NÃO contém virada — exceção da REGRA 2 quebrou a estratégia comercial!');

    if (!endsAsking(r3.text)) ok('NÃO termina com "qual plano faz mais sentido"');
    else fx('TERMINA com pergunta de plano — proibido pelo módulo planos_e_precos');

    if (r3.precoValidation?.valid) ok('preço validado contra plano_id (PR2 não-regressão)');
    else fx(`preço validation falhou: ${r3.precoValidation?.reason}`);
  });

  // ─── Resumo final ──────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`Resultado: ${pass} pass / ${fail} fail`);
  console.log(`Custo total: $${totalCost.toFixed(4)} USD | Latência total: ${(totalLatency / 1000).toFixed(1)}s`);
  console.log('═'.repeat(70));

  if (fail > 0) {
    console.log('\nFalhas:');
    for (const f of failures) console.log(`  - ${f}`);
  }

  // Salva output completo num JSON pro dono inspecionar.
  const outFile = path.join(require('os').tmpdir(), `smoke-v3-fluxo-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ summary: { pass, fail, costUSD: totalCost, latencyMs: totalLatency }, results: allResults, failures }, null, 2));
  console.log(`\nOutput completo salvo em: ${outFile}\n`);

  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error(`\n[smoke-v3-fluxo] erro fatal: ${e.message}\n${e.stack}`); process.exit(2); });
