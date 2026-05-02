#!/usr/bin/env node
// Testes do Roteador determinístico (router-v2.js).
// Roda offline (sem chamada de API), determinístico, sub-100ms.
// Vira regression test pra mudanças futuras nas regras.

const { routeModules, MAX_MODULES } = require('../src/router-v2');

// Cada caso: [nome, input, expectedSorted]
// Comparação ignora ordem (Set semantics).
const CASES = [
  // ─── Estado-based ───
  ['estagio apresentacao_planos → planos_e_precos',
    { state: { estagio_atual: 'apresentacao_planos' } },
    ['planos_e_precos']],
  ['estagio proposta_visita → fluxo_aula_experimental',
    { state: { estagio_atual: 'proposta_visita' } },
    ['fluxo_aula_experimental']],
  ['estagio drill_horario → fluxo_aula_experimental',
    { state: { estagio_atual: 'drill_horario' } },
    ['fluxo_aula_experimental']],
  ['objecao_ativa preco → objecao_preco + objecoes_geral',
    { state: { objecao_ativa: 'preco' } },
    ['objecao_preco', 'objecoes_geral']],
  ['objecao_ativa conjuge → objecao_conjuge + objecoes_geral',
    { state: { objecao_ativa: 'conjuge' } },
    ['objecao_conjuge', 'objecoes_geral']],
  ['objecao_ativa adiar → objecao_adiar + objecoes_geral',
    { state: { objecao_ativa: 'adiar' } },
    ['objecao_adiar', 'objecoes_geral']],
  ['estagio handoff_humano sem objecao → vazio',
    { state: { estagio_atual: 'handoff_humano' } },
    []],

  // ─── modulo_pendente preservado ───
  ['modulo_pendente sozinho',
    { modulo_pendente: 'tecnicas_persuasao' },
    ['tecnicas_persuasao']],
  ['modulo_pendente + estado dedup (mesmo módulo)',
    { state: { estagio_atual: 'apresentacao_planos' }, modulo_pendente: 'planos_e_precos' },
    ['planos_e_precos']],

  // ─── Públicos especiais ───
  ['gestante → publicos_especificos',
    { text: 'oi tô grávida posso treinar?' },
    ['publicos_especificos']],
  ['pós-parto explícito → publicos_especificos',
    { text: 'tô no pós-parto, posso voltar a treinar?' },
    ['publicos_especificos']],
  ['idoso 67 anos → publicos_especificos',
    { text: 'tenho 67 anos vocês atendem?' },
    ['publicos_especificos']],
  ['idosa palavra → publicos_especificos',
    { text: 'minha mãe é idosa, pode treinar?' },
    ['publicos_especificos']],
  ['adolescente menor → publicos_especificos',
    { text: 'meu filho adolescente quer começar' },
    ['publicos_especificos']],

  // ─── Saúde / lesão ───
  ['lesão joelho cirurgia → equipe_tecnica',
    { text: 'fiz cirurgia no joelho ano passado' },
    ['equipe_tecnica']],
  ['hérnia → equipe_tecnica',
    { text: 'tenho hérnia de disco' },
    ['equipe_tecnica']],
  ['joelho dói → equipe_tecnica',
    { text: 'meu joelho dói às vezes' },
    ['equipe_tecnica']],

  // ─── Objeções via keyword ───
  ['gympass → objecao_convenio',
    { text: 'vocês aceitam gympass?' },
    ['objecao_convenio']],
  ['mensal puro → objecao_mensal',
    { text: 'quero só o plano mensal' },
    ['objecao_mensal']],
  ['esposa precisa decidir → objecao_conjuge',
    { text: 'minha esposa precisa decidir junto' },
    ['objecao_conjuge']],

  // ─── Info academia ───
  ['estacionamento → info_academia',
    { text: 'tem estacionamento aí?' },
    ['info_academia']],
  ['vestiário → info_academia',
    { text: 'e vestiário, tem?' },
    ['info_academia']],
  ['horário → info_academia',
    { text: 'qual o horário?' },
    ['info_academia']],
  ['"como funciona o cancelamento" NÃO matcha info_academia',
    { text: 'como funciona o cancelamento?' },
    ['cancelamento_congelamento']],

  // ─── Modalidades ───
  ['musculação → modalidades',
    { text: 'tem aula de musculação?' },
    ['modalidades']],
  ['zumba → modalidades',
    { text: 'tem aula de zumba?' },
    ['modalidades']],
  ['pilates → modalidades',
    { text: 'gostaria de fazer pilates' },
    ['modalidades']],

  // ─── Política de plano ───
  ['cancelamento → cancelamento_congelamento',
    { text: 'como funciona o cancelamento?' },
    ['cancelamento_congelamento']],
  ['congelar plano → cancelamento_congelamento',
    { text: 'posso congelar o plano se viajar?' },
    ['cancelamento_congelamento']],
  ['fidelidade → cancelamento_congelamento',
    { text: 'tem fidelidade obrigatória?' },
    ['cancelamento_congelamento']],
  ['pix → pagamento',
    { text: 'aceita pix?' },
    ['pagamento']],
  ['parcelar cartão → pagamento',
    { text: 'dá pra parcelar no cartão?' },
    ['pagamento']],
  ['indicação amigo → indicacao',
    { text: 'tem free pass pra indicar amigo?' },
    ['indicacao']],

  // ─── Combinados ───
  ['estado + keyword diferente',
    { state: { objecao_ativa: 'preco' }, text: 'aceita pix?' },
    ['objecao_preco', 'objecoes_geral', 'pagamento']],
  ['modulo_pendente + estado',
    { state: { estagio_atual: 'apresentacao_planos' }, modulo_pendente: 'objecao_preco' },
    ['objecao_preco', 'planos_e_precos']],

  // ─── Limit defensivo ───
  ['limit MAX_MODULES respeitado',
    {
      state: { estagio_atual: 'apresentacao_planos', objecao_ativa: 'preco' },
      text: 'tem estacionamento e aceita pix?',
      modulo_pendente: 'tecnicas_persuasao',
    },
    null], // pula assert exato; só verifica contagem

  // ─── Vazio ───
  ['vazio → []', {}, []],
  ['só state vazio', { state: {} }, []],
  ['só text vazio', { text: '' }, []],
];

let pass = 0;
let fail = 0;
const fails = [];

for (const [name, input, expected] of CASES) {
  const got = routeModules(input);

  // Caso especial: limit (só verifica tamanho)
  if (expected === null) {
    if (got.length <= MAX_MODULES) {
      pass++;
      console.log(`✓ [${name}] → ${JSON.stringify(got)} (${got.length} ≤ ${MAX_MODULES})`);
    } else {
      fail++;
      fails.push({ name, got, expected: `≤ ${MAX_MODULES} módulos` });
      console.log(`✗ [${name}] → ${JSON.stringify(got)} (${got.length} > ${MAX_MODULES})`);
    }
    continue;
  }

  const ok = JSON.stringify(got.slice().sort()) === JSON.stringify(expected.slice().sort());
  if (ok) {
    pass++;
    console.log(`✓ [${name}] → ${JSON.stringify(got)}`);
  } else {
    fail++;
    fails.push({ name, got, expected });
    console.log(`✗ [${name}] → esperado ${JSON.stringify(expected.sort())}, recebeu ${JSON.stringify(got.sort())}`);
  }
}

console.log(`\n═══════════════════════════════════════════════════════════`);
console.log(`  Resultado: ${pass}/${pass + fail} passaram`);
console.log(`═══════════════════════════════════════════════════════════`);

if (fail > 0) {
  console.log(`\nFalhas:`);
  for (const f of fails) console.log(`  - ${f.name}`);
}

process.exit(fail > 0 ? 1 : 0);
