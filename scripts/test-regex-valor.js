#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// TESTE DO REGEX DETECTOR DE PEDIDO DE VALOR (Agent v2)
// ═══════════════════════════════════════════════════════════════
//
// 21 casos validados: 10 que DEVEM disparar + 10 que NÃO devem + 1
// falso positivo aceito.
// Roda: node scripts/test-regex-valor.js
//
// Não usa framework de teste (projeto é vanilla Node) — exit code 0
// se tudo passar, exit 1 se algo falhar.

const path = require('path');
process.env.WHATSAPP_PROVIDER = 'baileys';  // pra config.js não exigir vars Meta
const { detectsValueRequest } = require(path.resolve(__dirname, '..', 'src', 'agent-v2'));

const CASES = [
  // DEVEM disparar (10)
  { text: 'qual o valor?',                       expected: true,  group: 'positivo' },
  { text: 'quanto custa?',                       expected: true,  group: 'positivo' },
  { text: 'quanto fica a mensalidade?',          expected: true,  group: 'positivo' },
  { text: 'qual o preço?',                       expected: true,  group: 'positivo' },
  { text: 'me passa os preços',                  expected: true,  group: 'positivo' },
  { text: 'tem tabela?',                         expected: true,  group: 'positivo' },
  { text: 'qual o investimento mensal?',         expected: true,  group: 'positivo' },
  { text: 'tá muito caro pra mim',               expected: true,  group: 'positivo' },
  { text: 'tem algo mais barato?',               expected: true,  group: 'positivo' },
  { text: 'qual o orçamento desse plano?',       expected: true,  group: 'positivo' },

  // NÃO devem disparar (10)
  { text: 'qual o resultado que vou ter?',       expected: false, group: 'negativo' },
  { text: 'vocês dão valor pro aluno?',          expected: false, group: 'negativo' },
  { text: 'qual o valor da experiência aí?',     expected: false, group: 'negativo' },
  { text: 'tem tabela de treino?',               expected: false, group: 'negativo' },
  { text: 'quero ganhar massa',                  expected: false, group: 'negativo' },
  { text: 'como funciona a primeira aula?',      expected: false, group: 'negativo' },
  { text: 'vou pensar e te falo',                expected: false, group: 'negativo' },
  { text: 'fica longe daqui?',                   expected: false, group: 'negativo' },
  { text: 'tem treino pra emagrecer?',           expected: false, group: 'negativo' },
  { text: 'qual a diferença entre os planos?',   expected: false, group: 'negativo' },

  // Falso positivo aceito conscientemente (1)
  { text: 'barato é até quem sabe vender',       expected: true,  group: 'falso_positivo_aceito',
    note: 'frase figurada — vai disparar, aceitamos' },
];

let passed = 0;
let failed = 0;
const failures = [];

for (const c of CASES) {
  const got = detectsValueRequest(c.text);
  const ok = got === c.expected;
  if (ok) {
    passed++;
    console.log(`✓ [${c.group}] "${c.text}" → ${got}`);
  } else {
    failed++;
    failures.push({ ...c, got });
    console.log(`✗ [${c.group}] "${c.text}" → esperado ${c.expected}, recebido ${got}`);
  }
}

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  Resultado: ${passed}/${CASES.length} passaram`);
if (failed > 0) {
  console.log(`  ✗ ${failed} falha(s):`);
  for (const f of failures) {
    console.log(`     - "${f.text}" (esperava ${f.expected}, recebeu ${f.got})`);
  }
  process.exit(1);
}
console.log('═══════════════════════════════════════════════════════════');
process.exit(0);
