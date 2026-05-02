#!/usr/bin/env node
// Testes unitários de computeStateUpdate (agent-v2.js).
// Cobre lógica de mudança de objeção, incremento de tentativas, force handoff em 3.
// Roda offline (não chama API), determinístico, sub-100ms.
//
// Por que existe: a Bateria E.2 do scripts/baterias-v2.js depende de cenário
// LLM-driven de 4 turnos que não consegue exercitar 3 tentativas de mesma
// objeção (bot precisa de 2 turnos antes de começar a marcar objecao_ativa).
// Estes testes garantem que a LÓGICA está correta, independente do cenário.

const { computeStateUpdate, computeInsistenciasValor } = require('../src/agent-v2');

const CASES = [
  // ─── computeStateUpdate ───
  {
    name: 'sem stateFields (parsed sem tag) → no-op',
    fn: 'computeStateUpdate',
    input: [{ objecao_ativa: 'preco' }, { stateFields: null }],
    expect: { stateFields: null, appendedObjecao: null },
  },
  {
    name: 'objecao nova (era vazio) → reset tentativas + sinaliza append',
    fn: 'computeStateUpdate',
    input: [
      { objecao_ativa: '', tentativas_objecao_atual: 0 },
      { stateFields: { objecao_ativa: 'preco' } },
    ],
    expect: {
      stateFields: { objecao_ativa: 'preco', tentativas_objecao_atual: 0 },
      appendedObjecao: 'preco',
    },
  },
  {
    name: 'mesma objecao 1ª vez (tentativas 0 → 1)',
    fn: 'computeStateUpdate',
    input: [
      { objecao_ativa: 'preco', tentativas_objecao_atual: 0 },
      { stateFields: { objecao_ativa: 'preco' } },
    ],
    expect: {
      stateFields: { objecao_ativa: 'preco', tentativas_objecao_atual: 1 },
      appendedObjecao: null,
    },
  },
  {
    name: 'mesma objecao 2ª vez (tentativas 1 → 2)',
    fn: 'computeStateUpdate',
    input: [
      { objecao_ativa: 'preco', tentativas_objecao_atual: 1 },
      { stateFields: { objecao_ativa: 'preco' } },
    ],
    expect: {
      stateFields: { objecao_ativa: 'preco', tentativas_objecao_atual: 2 },
      appendedObjecao: null,
    },
  },
  {
    name: 'mesma objecao 3ª vez (tentativas 2 → 3) FORÇA HANDOFF',
    fn: 'computeStateUpdate',
    input: [
      { objecao_ativa: 'preco', tentativas_objecao_atual: 2 },
      { stateFields: { objecao_ativa: 'preco' } },
    ],
    expect: {
      stateFields: { objecao_ativa: 'preco', tentativas_objecao_atual: 3, estagio_atual: 'handoff_humano' },
      appendedObjecao: null,
    },
  },
  {
    name: 'mudança de objecao (preco → conjuge) reseta tentativas + sinaliza append',
    fn: 'computeStateUpdate',
    input: [
      { objecao_ativa: 'preco', tentativas_objecao_atual: 2 },
      { stateFields: { objecao_ativa: 'conjuge' } },
    ],
    expect: {
      stateFields: { objecao_ativa: 'conjuge', tentativas_objecao_atual: 0 },
      appendedObjecao: 'conjuge',
    },
  },
  {
    name: 'objecao limpa (era preco, agora vazio) → no-op nas tentativas',
    fn: 'computeStateUpdate',
    input: [
      { objecao_ativa: 'preco', tentativas_objecao_atual: 1 },
      { stateFields: { objecao_ativa: '' } },
    ],
    expect: {
      stateFields: { objecao_ativa: '' }, // não alterou tentativas
      appendedObjecao: null,
    },
  },
  {
    name: 'tentativas já em 3 ainda força handoff',
    fn: 'computeStateUpdate',
    input: [
      { objecao_ativa: 'preco', tentativas_objecao_atual: 3 },
      { stateFields: { objecao_ativa: 'preco' } },
    ],
    expect: {
      stateFields: { objecao_ativa: 'preco', tentativas_objecao_atual: 3, estagio_atual: 'handoff_humano' },
      appendedObjecao: null,
    },
  },

  // ─── computeInsistenciasValor ───
  {
    name: 'detecta "qual o valor" → +1',
    fn: 'computeInsistenciasValor',
    input: [0, 'qual o valor?'],
    expect: 1,
  },
  {
    name: 'detecta "quanto custa" → +1',
    fn: 'computeInsistenciasValor',
    input: [1, 'quanto custa?'],
    expect: 2,
  },
  {
    name: 'NÃO detecta "valor da experiência" (negative pattern)',
    fn: 'computeInsistenciasValor',
    input: [0, 'pra mim o valor da experiência conta mais'],
    expect: 0,
  },
  {
    name: 'clamp em 3 (não passa)',
    fn: 'computeInsistenciasValor',
    input: [3, 'qual o valor?'],
    expect: 3,
  },
  {
    name: 'clamp em 3 vindo de 2',
    fn: 'computeInsistenciasValor',
    input: [2, 'me passa os valores'],
    expect: 3,
  },
  {
    name: 'texto sem keyword de valor → mantém',
    fn: 'computeInsistenciasValor',
    input: [1, 'beleza, terça às 9h'],
    expect: 1,
  },
];

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

let pass = 0;
let fail = 0;
const fails = [];

for (const { name, fn, input, expect } of CASES) {
  const target = { computeStateUpdate, computeInsistenciasValor }[fn];
  const got = target(...input);
  const ok = deepEqual(got, expect);
  if (ok) {
    pass++;
    console.log(`✓ [${fn}] ${name}`);
  } else {
    fail++;
    fails.push({ name, fn, got, expect });
    console.log(`✗ [${fn}] ${name}`);
    console.log(`  esperado: ${JSON.stringify(expect)}`);
    console.log(`  recebeu:  ${JSON.stringify(got)}`);
  }
}

console.log(`\n═══════════════════════════════════════════════════════════`);
console.log(`  Resultado: ${pass}/${pass + fail} passaram`);
console.log(`═══════════════════════════════════════════════════════════`);

process.exit(fail > 0 ? 1 : 0);
