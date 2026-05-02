#!/usr/bin/env node
// Testes unitários do resumo dinâmico (Fase 3 / PR #36).
// Cobre: shouldUpdateResumo (lógica de trigger), stripTags, formatTranscript,
// buildResumoBlock. Roda offline, sub-100ms.
//
// gerarResumo() não é testado aqui (chama Haiku — tem custo). É exercitada
// no cenário F.1 da bateria scripts/baterias-v2.js.

const {
  shouldUpdateResumo,
  stripTags,
  formatTranscript,
  buildResumoBlock,
  TRIGGER_THRESHOLD,
  UPDATE_EVERY_N_MSGS,
} = require('../src/resumo-dinamico');

const CASES = [
  // ─── shouldUpdateResumo ───
  {
    name: 'state null → false',
    fn: 'shouldUpdateResumo',
    input: [null, 0],
    expect: { shouldUpdate: false },
    matchKey: 'shouldUpdate',
  },
  {
    name: 'abaixo do threshold (19 msgs)',
    fn: 'shouldUpdateResumo',
    input: [{}, TRIGGER_THRESHOLD - 1],
    expect: { shouldUpdate: false },
    matchKey: 'shouldUpdate',
  },
  {
    name: 'no threshold exato + sem resumo prévio → true (primeiro resumo)',
    fn: 'shouldUpdateResumo',
    input: [{ resumo_dinamico_n_msgs: 0 }, TRIGGER_THRESHOLD],
    expect: { shouldUpdate: true },
    matchKey: 'shouldUpdate',
  },
  {
    name: 'já tem resumo, msgs novas < UPDATE_EVERY_N_MSGS → false',
    fn: 'shouldUpdateResumo',
    input: [{ resumo_dinamico_n_msgs: 20 }, 25],
    expect: { shouldUpdate: false },
    matchKey: 'shouldUpdate',
  },
  {
    name: 'já tem resumo, msgs novas >= UPDATE_EVERY_N_MSGS → true (incremental)',
    fn: 'shouldUpdateResumo',
    input: [{ resumo_dinamico_n_msgs: 20 }, 20 + UPDATE_EVERY_N_MSGS],
    expect: { shouldUpdate: true },
    matchKey: 'shouldUpdate',
  },
  {
    name: 'msgs novas exatamente UPDATE_EVERY_N_MSGS → true',
    fn: 'shouldUpdateResumo',
    input: [{ resumo_dinamico_n_msgs: 30 }, 40],
    expect: { shouldUpdate: true },
    matchKey: 'shouldUpdate',
  },

  // ─── stripTags ───
  {
    name: 'remove [ESTADO:...]',
    fn: 'stripTags',
    input: ['[ESTADO:estagio=foo|nome=João]\nOlá! Tudo bem?'],
    expect: 'Olá! Tudo bem?',
  },
  {
    name: 'remove [MODULO_REQUERIDO:nome]',
    fn: 'stripTags',
    input: ['[MODULO_REQUERIDO:objecao_preco]\nTe entendo, mas...'],
    expect: 'Te entendo, mas...',
  },
  {
    name: 'remove [AGENDAMENTO:...] + [AUDIO]',
    fn: 'stripTags',
    input: ['[AGENDAMENTO:nome=Maria|dia=ter|hora=9h]\n[AUDIO]Tá fechado!'],
    expect: 'Tá fechado!',
  },
  {
    name: 'texto sem tags fica intacto',
    fn: 'stripTags',
    input: ['oi tudo bem?'],
    expect: 'oi tudo bem?',
  },
  {
    name: 'texto com [PEDIR_AUDIO] limpo',
    fn: 'stripTags',
    input: ['[PEDIR_AUDIO]Tu prefere áudio ou texto?'],
    expect: 'Tu prefere áudio ou texto?',
  },

  // ─── formatTranscript ───
  {
    name: 'formata user/assistant como LEAD/JOHNNY',
    fn: 'formatTranscript',
    input: [[
      { role: 'user', content: 'oi tô parado faz tempo' },
      { role: 'assistant', content: '[ESTADO:estagio=qualificacao_objetivo]\nE aí beleza! Treinar pra que objetivo?' },
    ]],
    expect: 'LEAD: oi tô parado faz tempo\nJOHNNY: E aí beleza! Treinar pra que objetivo?',
  },
  {
    name: 'array vazio → string vazia',
    fn: 'formatTranscript',
    input: [[]],
    expect: '',
  },

  // ─── buildResumoBlock ───
  {
    name: 'state null → string vazia',
    fn: 'buildResumoBlock',
    input: [null],
    expect: '',
  },
  {
    name: 'state sem resumo_dinamico → string vazia',
    fn: 'buildResumoBlock',
    input: [{ estagio_atual: 'foo' }],
    expect: '',
  },
  {
    name: 'state com resumo → bloco formatado com header e nota',
    fn: 'buildResumoBlock',
    input: [{ resumo_dinamico: 'LEAD: João\nOBJETIVO: emagrecer', resumo_dinamico_n_msgs: 20 }],
    matchSubstrings: ['═══ RESUMO DA CONVERSA ANTERIOR ═══', 'LEAD: João', '20 mensagens'],
  },
];

let pass = 0;
let fail = 0;
const fns = { shouldUpdateResumo, stripTags, formatTranscript, buildResumoBlock };

for (const c of CASES) {
  const got = fns[c.fn](...c.input);
  let ok = false;
  if (c.matchSubstrings) {
    ok = c.matchSubstrings.every(s => String(got).includes(s));
  } else if (c.matchKey) {
    ok = got[c.matchKey] === c.expect[c.matchKey];
  } else {
    ok = got === c.expect;
  }
  if (ok) {
    pass++;
    console.log(`✓ [${c.fn}] ${c.name}`);
  } else {
    fail++;
    console.log(`✗ [${c.fn}] ${c.name}`);
    console.log(`  esperado: ${JSON.stringify(c.expect || c.matchSubstrings)}`);
    console.log(`  recebeu:  ${JSON.stringify(got)}`);
  }
}

console.log(`\n═══════════════════════════════════════════════════════════`);
console.log(`  Resultado: ${pass}/${pass + fail} passaram`);
console.log(`═══════════════════════════════════════════════════════════`);

process.exit(fail > 0 ? 1 : 0);
