#!/usr/bin/env node
// Smoke test pré-merge — pedido pelo sócio.
//
// Valida que assembleNucleoV2(personaDefault) produz um prompt FUNCIONAL,
// chamando o Anthropic real com o cenário E.4 (Tag malformada / resiliência)
// que é estável na Bateria E.
//
// E.4 input: "oi qual valor" (1 turno).
// Asserts (mesma da Bateria E):
//   - resposta não tem literal [ESTADO: / [MODULO_REQUERIDO: / [AGENDAMENTO:
//     vazando no texto (parser tem que ter limpado todas as tags)
//   - cleanText não-vazio (resposta tem texto pro lead)
//   - tags foram parseadas (parsed.stateFields existe — prova que LLM
//     emitiu protocolo conforme núcleo manda)
//
// Custo: ~$0.005 USD (1 turno). Roda em ~3-5s.
//
// Pré-requisitos:
//   - .env com ANTHROPIC_API_KEY
//   - DB_PATH pode ser temp (:memory: não rola com better-sqlite3 nesse setup,
//     uso um path temp file que é limpo no fim)

const path = require('path');
const fs = require('fs');
const os = require('os');

// DB temp pra não tocar produção
const tmpDb = path.join(os.tmpdir(), `stronix-smoke-persona-${Date.now()}.sqlite`);
process.env.DB_PATH = tmpDb;
require('dotenv').config({ override: true });

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ERRO: ANTHROPIC_API_KEY não definida no .env');
  process.exit(1);
}

const { simulateReplyV2 } = require('../src/agent-v2');
const { assembleNucleoV2, DEFAULT_PERSONA, isPersonaCustom } = require('../src/persona-v2');

(async () => {
  console.log('[smoke-persona-e4] iniciando — cenário E.4 com persona default\n');

  // Confirma que estamos usando default persona (DB temp limpo)
  if (isPersonaCustom()) {
    console.error('ERRO: DB temp não está limpo, persona já foi customizada?');
    process.exit(1);
  }
  console.log('  ✓ persona = default (DB temp limpo)');

  // Confirma que o assemble com default produz núcleo válido (sanity check
  // antes de gastar com Anthropic)
  const assembled = assembleNucleoV2(DEFAULT_PERSONA);
  if (/\{\{[A-Z_]+\}\}/.test(assembled)) {
    console.error('ERRO: assemble(default) ainda tem placeholders:', assembled.match(/\{\{[A-Z_]+\}\}/));
    process.exit(1);
  }
  if (assembled.length < 10000) {
    console.error(`ERRO: núcleo assembled muito curto (${assembled.length} chars), esperava >= 10000`);
    process.exit(1);
  }
  console.log(`  ✓ assemble(default) gerou ${assembled.length} chars sem placeholders\n`);

  // ─── Roda E.4 ───
  const userMsg = 'oi qual valor';
  console.log(`  rodando turno: user="${userMsg}"`);

  const t0 = Date.now();
  let result;
  try {
    result = await simulateReplyV2([], userMsg, null);
  } catch (e) {
    console.error(`\n💥 simulateReplyV2 crashed: ${e.message}`);
    if (e.stack) console.error(e.stack.split('\n').slice(0, 4).join('\n'));
    process.exit(1);
  }
  const elapsed = Date.now() - t0;

  console.log(`  ⏱ ${elapsed}ms · in:${result.tokensInput} (cache:${result.cacheReadTokens}) out:${result.tokensOutput}\n`);
  console.log(`  Resposta IA:\n  ─────────`);
  result.text.split('\n').forEach(l => console.log(`  > ${l}`));
  console.log(`  ─────────\n`);

  // ─── Asserts E.4 (idênticos aos da scripts/baterias-v2.js) ───
  const failures = [];

  if (/\[ESTADO:/i.test(result.text)) {
    failures.push('resposta contém literal [ESTADO: — parser falhou');
  }
  if (/\[MODULO_REQUERIDO:/i.test(result.text)) {
    failures.push('resposta contém literal [MODULO_REQUERIDO: — parser falhou');
  }
  if (/\[AGENDAMENTO:/i.test(result.text)) {
    failures.push('resposta contém literal [AGENDAMENTO: — parser falhou');
  }
  if (!result.text || !result.text.trim()) {
    failures.push('cleanText vazio — bot não respondeu nada pro lead');
  }
  if (!result.parsed || !result.parsed.stateFields) {
    failures.push('parsed.stateFields ausente — bot não emitiu tag [ESTADO:] (núcleo customizado pode ter quebrado o protocolo)');
  }

  // Custo aproximado (Sonnet 4.5 pricing: $3/MTok input non-cache, $0.30 cache, $15/MTok output)
  const costUSD = (
    (result.tokensInput || 0) * 3 / 1_000_000 +
    (result.cacheReadTokens || 0) * 0.30 / 1_000_000 +
    (result.cacheCreationTokens || 0) * 3.75 / 1_000_000 +
    (result.tokensOutput || 0) * 15 / 1_000_000
  );

  if (failures.length === 0) {
    console.log(`  ✅ E.4 PASS — persona default + assembleNucleoV2 produzem prompt funcional`);
    console.log(`  💰 custo: $${costUSD.toFixed(4)} (~R$ ${(costUSD * 5.5).toFixed(3)})\n`);
    cleanupTmp();
    process.exit(0);
  } else {
    console.log(`  ❌ E.4 FAIL — ${failures.length} assert(s) quebraram:`);
    for (const f of failures) console.log(`     - ${f}`);
    console.log(`  💰 custo: $${costUSD.toFixed(4)}\n`);
    cleanupTmp();
    process.exit(1);
  }

  function cleanupTmp() {
    try {
      fs.unlinkSync(tmpDb);
      // SQLite WAL/SHM
      ['-wal', '-shm'].forEach(suf => {
        try { fs.unlinkSync(tmpDb + suf); } catch {}
      });
    } catch {}
  }
})();
