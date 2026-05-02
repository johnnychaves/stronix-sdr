#!/usr/bin/env node
// Testes unitários dos detectors do PR #37 (admin tooling).
// Cobre: extractMoneyValues, isLikelyDerivation, detectsPrecoInventado,
// detectsValorAntecipado, detectsTagEsquecida, extractPrecosOficiais.
// Roda offline (sem API), sub-100ms.

const {
  extractMoneyValues,
  isLikelyDerivation,
  detectsPrecoInventado,
  detectsValorAntecipado,
  detectsTagEsquecida,
  extractPrecosOficiaisFromAcademiaInfo,
} = require('../src/v2-detectors');

const CASES = [
  // ─── extractMoneyValues ───
  { fn: 'extractMoneyValues', name: 'R$ com cifra', input: ['Plano R$ 199/mês'], expect: [199] },
  { fn: 'extractMoneyValues', name: 'R$ sem espaço', input: ['R$199'], expect: [199] },
  { fn: 'extractMoneyValues', name: 'com vírgula decimal', input: ['R$ 109,90/mês'], expect: [109.9] },
  { fn: 'extractMoneyValues', name: 'sufixo reais', input: ['custa 199 reais'], expect: [199] },
  { fn: 'extractMoneyValues', name: 'múltiplos valores', input: ['Flex R$ 199, No Limit R$ 149'], expect: [199, 149] },
  { fn: 'extractMoneyValues', name: 'sem valor', input: ['Beleza terça às 9h'], expect: [] },
  { fn: 'extractMoneyValues', name: 'R$ 3,60 por dia', input: ['R$ 3,60 por dia'], expect: [3.6] },
  { fn: 'extractMoneyValues', name: 'string vazia', input: [''], expect: [] },
  { fn: 'extractMoneyValues', name: 'null safe', input: [null], expect: [] },

  // ─── isLikelyDerivation ───
  { fn: 'isLikelyDerivation', name: 'valor < R$1', input: [0.5, [99, 109, 149, 199]], expect: true },
  { fn: 'isLikelyDerivation', name: 'R$3,60 vs R$99 menor (3.6%)', input: [3.6, [99, 109, 149, 199]], expect: true },
  { fn: 'isLikelyDerivation', name: 'R$15 vs R$99 (15.1%)', input: [15, [99, 109, 149, 199]], expect: false },
  { fn: 'isLikelyDerivation', name: 'R$199 exato', input: [199, [99, 109, 149, 199]], expect: true },
  { fn: 'isLikelyDerivation', name: 'R$200 (5% tolerância de 199)', input: [200, [99, 109, 149, 199]], expect: true },
  { fn: 'isLikelyDerivation', name: 'R$300 (longe de qualquer)', input: [300, [99, 109, 149, 199]], expect: false },

  // ─── detectsPrecoInventado ───
  { fn: 'detectsPrecoInventado', name: 'preço oficial não dispara', input: ['Plano R$ 199', [99, 109, 149, 199]], expectKey: 'triggered', expectVal: false },
  { fn: 'detectsPrecoInventado', name: 'preço inventado dispara', input: ['Promo só hoje R$ 350', [99, 109, 149, 199]], expectKey: 'triggered', expectVal: true },
  { fn: 'detectsPrecoInventado', name: 'derivação por dia não dispara', input: ['R$ 3,60 por dia', [99, 109, 149, 199]], expectKey: 'triggered', expectVal: false },
  { fn: 'detectsPrecoInventado', name: 'sem valor mencionado', input: ['Beleza terça', [99, 109, 149]], expectKey: 'triggered', expectVal: false },
  { fn: 'detectsPrecoInventado', name: 'sem oficiais não dispara', input: ['Plano R$ 199', []], expectKey: 'triggered', expectVal: false },
  { fn: 'detectsPrecoInventado', name: 'oficiais null safe', input: ['Plano R$ 199', null], expectKey: 'triggered', expectVal: false },

  // ─── detectsValorAntecipado ───
  { fn: 'detectsValorAntecipado', name: 'insist=0 + R$ alto dispara', input: ['Custa R$ 199', 0], expectKey: 'triggered', expectVal: true },
  { fn: 'detectsValorAntecipado', name: 'insist=2 + R$ alto dispara', input: ['Plano R$ 149', 2], expectKey: 'triggered', expectVal: true },
  { fn: 'detectsValorAntecipado', name: 'insist=3 + R$ alto NÃO dispara', input: ['Custa R$ 199', 3], expectKey: 'triggered', expectVal: false },
  { fn: 'detectsValorAntecipado', name: 'insist=0 + R$ derivação NÃO dispara', input: ['R$ 3,60 por dia', 0], expectKey: 'triggered', expectVal: false },
  { fn: 'detectsValorAntecipado', name: 'sem valor não dispara', input: ['Beleza terça', 0], expectKey: 'triggered', expectVal: false },

  // ─── detectsTagEsquecida ───
  { fn: 'detectsTagEsquecida', name: 'parsed null', input: [null], expectKey: 'triggered', expectVal: true },
  { fn: 'detectsTagEsquecida', name: 'parsed sem stateFields', input: [{ stateFields: null }], expectKey: 'triggered', expectVal: true },
  { fn: 'detectsTagEsquecida', name: 'parsed com stateFields', input: [{ stateFields: { x: 1 } }], expectKey: 'triggered', expectVal: false },

  // ─── extractPrecosOficiaisFromAcademiaInfo ───
  { fn: 'extractPrecosOficiaisFromAcademiaInfo', name: 'extrai de chaves valor/preco', input: [{ plano_flex_valor: 'R$ 199/mês', plano_no_limit_valor: 'R$ 149/mês', endereco: 'Rua X 123' }], expectArrLength: 2 },
  { fn: 'extractPrecosOficiaisFromAcademiaInfo', name: 'inclui matricula', input: [{ matricula_valor: 'R$ 99', plano_clube_valor: 'R$ 109' }], expectArrLength: 2 },
  { fn: 'extractPrecosOficiaisFromAcademiaInfo', name: 'ignora chaves não-monetárias', input: [{ horario: '6h-22h', endereco: 'Rua X' }], expectArrLength: 0 },
  { fn: 'extractPrecosOficiaisFromAcademiaInfo', name: 'null safe', input: [null], expectArrLength: 0 },
];

const fns = {
  extractMoneyValues,
  isLikelyDerivation,
  detectsPrecoInventado,
  detectsValorAntecipado,
  detectsTagEsquecida,
  extractPrecosOficiaisFromAcademiaInfo,
};

let pass = 0, fail = 0;
for (const c of CASES) {
  const got = fns[c.fn](...c.input);
  let ok;
  if (c.expectArrLength !== undefined) ok = Array.isArray(got) && got.length === c.expectArrLength;
  else if (c.expectKey) ok = got && got[c.expectKey] === c.expectVal;
  else ok = JSON.stringify(got) === JSON.stringify(c.expect);
  if (ok) {
    pass++;
    console.log(`✓ [${c.fn}] ${c.name}`);
  } else {
    fail++;
    console.log(`✗ [${c.fn}] ${c.name}`);
    console.log(`  esperado: ${JSON.stringify(c.expect ?? (c.expectKey + '=' + c.expectVal) ?? ('len=' + c.expectArrLength))}`);
    console.log(`  recebeu:  ${JSON.stringify(got)}`);
  }
}

console.log(`\n═══════════════════════════════════════════════════════════`);
console.log(`  Resultado: ${pass}/${pass + fail} passaram`);
console.log(`═══════════════════════════════════════════════════════════`);
process.exit(fail > 0 ? 1 : 0);
