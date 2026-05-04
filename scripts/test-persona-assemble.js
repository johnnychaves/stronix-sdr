#!/usr/bin/env node
// Smoke test offline (sem rede) do persona-v2.
// Garante:
// 1. assembleNucleoV2(DEFAULT_PERSONA) NÃO contém placeholders {{...}}
// 2. Mantém todas as gírias quentes/proibidas/abertura do default
// 3. Persona vazia/null cai pro default
// 4. Custom persona substitui corretamente (e só nas regiões esperadas)
// 5. mergeWithDefaults clamps tamanhos limite (item > 200 chars, lista > 30 items)
// 6. JSON inválido no DB cai pro default sem crashar
// 7. assembleNucleoV2 é estável (mesmo input → mesmo output, sem mutação)
// 8. Smoke do prompt final ainda tem todas as seções estruturais
//    (TOPO BLINDADO, MÁQUINA DE ESTADO, REGRAS DE OURO, etc.)
//
// Roda standalone: `node scripts/test-persona-assemble.js`
// Não chama Anthropic API — só valida o assemble e a integração com mock DB.

const path = require('path');
const fs = require('fs');

// Mock pequeno do db.js — persona-v2 usa db.getAgentConfig/setAgentConfig.
// Ao invés de subir SQLite real, sobrescrevo o módulo com um stub em memória.
const dbPath = require.resolve('../src/db.js');
let mockStorage = {};
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    getAgentConfig: (key, fallback) => (mockStorage[key] !== undefined ? mockStorage[key] : fallback),
    setAgentConfig: (key, value) => {
      if (value === null || value === undefined || value === '') delete mockStorage[key];
      else mockStorage[key] = value;
    },
  },
};

// Agora carrega o módulo (que vai usar o stub)
const personaModule = require('../src/persona-v2');
const NUCLEO_TEMPLATE = require('../src/prompt-nucleo-v2');

let pass = 0, fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    failures.push({ name, error: e.message });
    console.log(`  ✗ ${name}\n    ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log('\n[test-persona-assemble] iniciando\n');

// ─── 1. Default assemble ───
console.log('1. Default assemble');
test('NUCLEO_TEMPLATE contém placeholders {{PERSONA_*}}', () => {
  const required = [
    'PERSONA_NOME_AGENTE',
    'PERSONA_NOME_AGENTE_UPPER',
    'PERSONA_NOME_NEGOCIO',
    'PERSONA_NOME_NEGOCIO_UPPER',
    'PERSONA_DESCRICAO_JEITO',
    'PERSONA_ABERTURA',
    'PERSONA_BINARIA_TREINANDO',
    'PERSONA_BINARIA_OBJETIVO',
    'PERSONA_BINARIA_OBJETIVO_DRILL',
    'PERSONA_BINARIA_NOME',
    'PERSONA_BINARIA_TURNO',
    'PERSONA_BINARIA_DIA',
    'PERSONA_BINARIA_HORA',
    'PERSONA_REGRA_VALORES_BLOCK',
    'PERSONA_PASSA_VALOR_EM',
    'PERSONA_GIRIAS_QUENTES',
    'PERSONA_GIRIAS_PROIBIDAS',
    'PERSONA_FRASES_PROIBIDAS_EXTRA_BLOCK',
  ];
  for (const ph of required) {
    const re = new RegExp('\\{\\{' + ph + '\\}\\}');
    assert(re.test(NUCLEO_TEMPLATE), `template sem {{${ph}}}`);
  }
});

test('assembleNucleoV2(DEFAULT) não tem placeholders sobrando', () => {
  const out = personaModule.assembleNucleoV2(personaModule.DEFAULT_PERSONA);
  assert(!/\{\{[A-Z_]+\}\}/.test(out), `placeholder não substituído: ${(out.match(/\{\{[A-Z_]+\}\}/) || ['?'])[0]}`);
});

test('assembleNucleoV2(undefined) === assembleNucleoV2(DEFAULT)', () => {
  const a = personaModule.assembleNucleoV2(undefined);
  const b = personaModule.assembleNucleoV2(personaModule.DEFAULT_PERSONA);
  assert(a === b, 'undefined deveria cair pro default');
});

test('assembleNucleoV2(null) === assembleNucleoV2(DEFAULT)', () => {
  const a = personaModule.assembleNucleoV2(null);
  const b = personaModule.assembleNucleoV2(personaModule.DEFAULT_PERSONA);
  assert(a === b, 'null deveria cair pro default');
});

test('assembleNucleoV2({}) === assembleNucleoV2(DEFAULT)', () => {
  const a = personaModule.assembleNucleoV2({});
  const b = personaModule.assembleNucleoV2(personaModule.DEFAULT_PERSONA);
  assert(a === b, 'obj vazio deveria cair pro default (todos campos vão usar fallback)');
});

// ─── 2. Conteúdo preservado ───
console.log('\n2. Conteúdo do default preservado no assemble');
test('contém abertura "Opa beleza! Sou o Johnny da STRONIX"', () => {
  const out = personaModule.assembleNucleoV2(personaModule.DEFAULT_PERSONA);
  assert(out.includes('Opa beleza! Sou o Johnny da STRONIX'), 'abertura default ausente');
});

test('contém nomeAgente "Johnny" no quem-você-é', () => {
  const out = personaModule.assembleNucleoV2(personaModule.DEFAULT_PERSONA);
  assert(out.includes('Você é o Johnny'), 'nome do agente default ausente em "Você é o..."');
});

test('contém nomeNegocio "STRONIX" e versão UPPER', () => {
  const out = personaModule.assembleNucleoV2(personaModule.DEFAULT_PERSONA);
  assert(out.includes('STRONIX'), 'nome do negócio default ausente');
  assert(out.includes('JOHNNY — STRONIX ACADEMIA'), 'header com UPPER ausente');
});

test('contém descricaoJeito default "genuíno, sério, direto..."', () => {
  const out = personaModule.assembleNucleoV2(personaModule.DEFAULT_PERSONA);
  assert(out.includes('genuíno, sério, direto, sem papo de vendedor'), 'descrição do jeito default ausente');
});

test('contém todas as 7 binárias do roteiro com defaults exatos', () => {
  const out = personaModule.assembleNucleoV2(personaModule.DEFAULT_PERSONA);
  const expected = [
    'Tu tá treinando ou parado?',
    'Mais resultado físico ou mais qualidade de vida no dia a dia?',
    'ganhar massa ou emagrecer?',
    'A propósito, como é teu nome?',
    'manhã ou final do dia?',
    'Posso te encaixar terça ou quarta, qual rola pra ti?',
    'Tem 9h ou 10h, qual prefere?',
  ];
  for (const e of expected) {
    assert(out.includes(e), `binária default "${e}" ausente no assemble`);
  }
});

test('contém defletores de valor com defaults exatos (N=3 default)', () => {
  const out = personaModule.assembleNucleoV2(personaModule.DEFAULT_PERSONA);
  assert(out.includes('Claro, já chegamos lá. Mas antes me conta...'), 'defletorValor1 default ausente');
  assert(out.includes('Bem rapidinho antes...'), 'defletorValor2 default ausente');
});

test('custom defletores substituem hardcodes (N=3)', () => {
  const out = personaModule.assembleNucleoV2({
    defletorValor1: 'Vamos chegar lá, mas antes me conta...',
    defletorValor2: 'Antes do valor, só uma última coisa rapidinha...',
  });
  assert(out.includes('Vamos chegar lá, mas antes me conta...'), 'defletor1 custom ausente');
  assert(out.includes('Antes do valor, só uma última coisa rapidinha...'), 'defletor2 custom ausente');
  assert(!out.includes('Claro, já chegamos lá'), 'defletor1 default ainda presente');
  assert(!out.includes('Bem rapidinho antes'), 'defletor2 default ainda presente');
});

// ─── Regra dos valores parametrizada por N ───
console.log('\n3b. Regra dos valores parametrizada por passaValorEmInsistencia');

test('N=1: passa imediato, sem defletores', () => {
  const out = personaModule.assembleNucleoV2({ passaValorEmInsistencia: 1 });
  assert(out.includes('insistencias_valor=1 → estagio=apresentacao_planos'), 'N=1 deveria ir direto pra apresentacao_planos');
  assert(!out.includes('defletor'), 'N=1 não deveria mencionar defletores');
  assert(!out.includes('Claro, já chegamos'), 'N=1 não deveria conter defletor1');
  assert(!out.includes('Bem rapidinho'), 'N=1 não deveria conter defletor2');
});

test('N=2: 1 defletor (defletor1) antes de apresentar', () => {
  const out = personaModule.assembleNucleoV2({ passaValorEmInsistencia: 2 });
  assert(out.includes('insistencias_valor=1 → "Claro, já chegamos lá. Mas antes me conta..."'), 'N=2 deveria usar defletor1 na 1ª');
  assert(out.includes('insistencias_valor=2 → estagio=apresentacao_planos'), 'N=2 deveria apresentar na 2ª');
  assert(!out.includes('Bem rapidinho'), 'N=2 não deveria usar defletor2');
});

test('N=3 (default): 2 defletores antes de apresentar', () => {
  const out = personaModule.assembleNucleoV2({ passaValorEmInsistencia: 3 });
  assert(out.includes('insistencias_valor=1 → "Claro, já chegamos lá'), 'N=3 deveria usar defletor1 na 1ª');
  assert(out.includes('insistencias_valor=2 → "Bem rapidinho antes..."'), 'N=3 deveria usar defletor2 na 2ª');
  assert(out.includes('insistencias_valor=3 → estagio=apresentacao_planos'), 'N=3 deveria apresentar na 3ª');
});

test('N=5: defletor1 nas 3 iniciais, defletor2 na 4ª, apresenta na 5ª', () => {
  const out = personaModule.assembleNucleoV2({ passaValorEmInsistencia: 5 });
  assert(out.includes('insistencias_valor=1 → "Claro'), 'N=5: 1ª deveria usar defletor1');
  assert(out.includes('insistencias_valor=2 → "Claro'), 'N=5: 2ª deveria usar defletor1');
  assert(out.includes('insistencias_valor=3 → "Claro'), 'N=5: 3ª deveria usar defletor1');
  assert(out.includes('insistencias_valor=4 → "Bem rapidinho'), 'N=5: 4ª deveria usar defletor2');
  assert(out.includes('insistencias_valor=5 → estagio=apresentacao_planos'), 'N=5: 5ª deveria apresentar');
});

test('CHECAGEM FINAL menciona o N correto', () => {
  const out2 = personaModule.assembleNucleoV2({ passaValorEmInsistencia: 2 });
  assert(out2.includes('insistencias_valor=2?'), 'checagem final deveria mencionar insistencias_valor=2');
  const out3 = personaModule.assembleNucleoV2({ passaValorEmInsistencia: 3 });
  assert(out3.includes('insistencias_valor=3?'), 'checagem final deveria mencionar insistencias_valor=3');
});

test('passaValorEmInsistencia faz clamp no range 1-5', () => {
  const m0 = personaModule.mergeWithDefaults({ passaValorEmInsistencia: 0 });
  assert(m0.passaValorEmInsistencia === 1, `0 deveria virar 1, virou ${m0.passaValorEmInsistencia}`);
  const m100 = personaModule.mergeWithDefaults({ passaValorEmInsistencia: 100 });
  assert(m100.passaValorEmInsistencia === 5, `100 deveria virar 5, virou ${m100.passaValorEmInsistencia}`);
  const mNan = personaModule.mergeWithDefaults({ passaValorEmInsistencia: 'abc' });
  assert(mNan.passaValorEmInsistencia === 3, `string deveria cair pro default 3, virou ${mNan.passaValorEmInsistencia}`);
});

test('contém todas as gírias quentes do default', () => {
  const out = personaModule.assembleNucleoV2(personaModule.DEFAULT_PERSONA);
  for (const g of personaModule.DEFAULT_PERSONA.giriasQuentes) {
    assert(out.includes(`"${g}"`), `gíria quente "${g}" ausente no assemble`);
  }
});

test('contém todas as gírias proibidas do default', () => {
  const out = personaModule.assembleNucleoV2(personaModule.DEFAULT_PERSONA);
  for (const g of personaModule.DEFAULT_PERSONA.giriasProibidas) {
    assert(out.includes(`"${g}"`), `gíria proibida "${g}" ausente no assemble`);
  }
});

test('NÃO contém bloco "frases extras" quando lista vazia (default)', () => {
  const out = personaModule.assembleNucleoV2(personaModule.DEFAULT_PERSONA);
  assert(!out.includes('PROIBIDO TAMBÉM'), 'bloco extra não deveria aparecer com lista vazia');
});

// ─── 3. Custom persona ───
console.log('\n3. Custom persona substitui corretamente');
test('custom nomeAgente substitui Johnny em todas as ocorrências', () => {
  const out = personaModule.assembleNucleoV2({ nomeAgente: 'Bruno' });
  assert(out.includes('Você é o Bruno'), 'nome custom não substituiu em "Você é o..."');
  assert(out.includes('Sou o Bruno da'), 'nome custom não substituiu na abertura do exemplo');
  assert(out.includes('BRUNO —'), 'nome custom UPPER não apareceu no header');
  assert(!out.includes('Você é o Johnny'), 'nome default ainda apareceu onde deveria ter sido substituído');
});

test('custom nomeNegocio substitui STRONIX em todas ocorrências relevantes', () => {
  const out = personaModule.assembleNucleoV2({ nomeNegocio: 'TopFit' });
  assert(out.includes('dono da TopFit'), 'nome do negócio custom não substituiu em "dono da..."');
  assert(out.includes('assistente virtual da TopFit'), 'nome custom não substituiu no handoff IA');
  assert(out.includes('TOPFIT'), 'nome custom UPPER não apareceu');
});

test('custom descricaoJeito substitui frase do jeito', () => {
  const out = personaModule.assembleNucleoV2({
    descricaoJeito: 'caloroso, próximo, jeito amigo de bairro'
  });
  assert(out.includes('caloroso, próximo, jeito amigo de bairro'), 'descrição custom não foi injetada');
  assert(!out.includes('genuíno, sério, direto'), 'descrição default ainda presente quando deveria ter sumido');
});

test('custom binárias substituem todas as 7 perguntas do roteiro', () => {
  const out = personaModule.assembleNucleoV2({
    binariaTreinando: 'Cê tá na ativa ou meio sumido?',
    binariaObjetivo: 'Foco mais em forma ou em saúde mesmo?',
    binariaObjetivoDrill: 'crescer mais ou emagrecer mais?',
    binariaNome: 'Como tu se chama?',
    binariaTurno: 'cedo ou de tardezinha?',
    binariaDia: 'Que tal terça ou quinta?',
    binariaHora: '8h ou 11h?',
  });
  // Customs aparecem
  assert(out.includes('Cê tá na ativa ou meio sumido?'), 'binariaTreinando custom ausente');
  assert(out.includes('Foco mais em forma ou em saúde mesmo?'), 'binariaObjetivo custom ausente');
  assert(out.includes('crescer mais ou emagrecer mais?'), 'binariaObjetivoDrill custom ausente');
  assert(out.includes('Como tu se chama?'), 'binariaNome custom ausente');
  assert(out.includes('cedo ou de tardezinha?'), 'binariaTurno custom ausente');
  assert(out.includes('Que tal terça ou quinta?'), 'binariaDia custom ausente');
  assert(out.includes('8h ou 11h?'), 'binariaHora custom ausente');
  // Defaults sumiram
  assert(!out.includes('Tu tá treinando ou parado?'), 'default Treinando ainda presente');
  assert(!out.includes('Mais resultado físico ou mais qualidade'), 'default Objetivo ainda presente');
});

test('placeholder PERSONA_BINARIA_OBJETIVO não é prefix-ambíguo com OBJETIVO_DRILL', () => {
  // Regression: garante que substituir OBJETIVO antes de OBJETIVO_DRILL não quebra
  const out = personaModule.assembleNucleoV2({
    binariaObjetivo: 'XXX',
    binariaObjetivoDrill: 'YYY',
  });
  assert(out.includes('"XXX"'), 'OBJETIVO custom não substituiu');
  assert(out.includes('"YYY"'), 'OBJETIVO_DRILL custom não substituiu');
  assert(!out.includes('XXX_DRILL'), 'OBJETIVO substituiu DENTRO do OBJETIVO_DRILL — ordem de replace está errada');
});

test('custom abertura aparece na linha "ABERTURA PADRÃO" do núcleo', () => {
  const out = personaModule.assembleNucleoV2({
    abertura: 'E aí parça, tô na escuta!',
    giriasQuentes: ['Top'],
    giriasProibidas: ['Excelente!'],
    frasesProibidasExtra: [],
  });
  // Match: "ABERTURA PADRÃO (... ): <abertura>"
  const m = out.match(/ABERTURA PADRÃO[^:]*:\s*(.+)/);
  assert(m, 'linha ABERTURA PADRÃO ausente');
  assert(m[1].includes('E aí parça, tô na escuta!'), `abertura custom não foi injetada na linha ABERTURA PADRÃO. Encontrado: "${m[1].slice(0, 80)}"`);
  // O exemplo do anti-padrão ainda menciona "Opa beleza" como amostra, é OK —
  // a INSTRUÇÃO oficial é a linha ABERTURA PADRÃO, e essa foi substituída.
});

test('custom giriasQuentes substitui lista default', () => {
  const out = personaModule.assembleNucleoV2({
    giriasQuentes: ['Top', 'Daora'],
  });
  assert(out.includes('"Top"'), 'gíria custom ausente');
  assert(out.includes('"Daora"'), 'gíria custom ausente');
  assert(!out.includes('"Bah"'), 'gíria default ainda presente quando deveria ser substituída');
});

test('frasesProibidasExtra preenchidas viram bloco visível', () => {
  const out = personaModule.assembleNucleoV2({
    frasesProibidasExtra: ['Vamos juntos!', 'Top demais!'],
  });
  assert(out.includes('PROIBIDO TAMBÉM'), 'bloco extra ausente quando deveria existir');
  assert(out.includes('"Vamos juntos!"'), 'frase extra ausente');
  assert(out.includes('"Top demais!"'), 'frase extra ausente');
});

// ─── 4. Validação / clamp ───
console.log('\n4. Validação e clamp');
test('item > 200 chars é truncado', () => {
  const longStr = 'a'.repeat(500);
  const merged = personaModule.mergeWithDefaults({ giriasQuentes: [longStr] });
  assert(merged.giriasQuentes[0].length <= personaModule.LIMITS.ITEM_MAX, 'item não truncado');
});

test('lista > 30 items é cortada', () => {
  const huge = Array.from({ length: 100 }, (_, i) => `g${i}`);
  const merged = personaModule.mergeWithDefaults({ giriasQuentes: huge });
  assert(merged.giriasQuentes.length === personaModule.LIMITS.LIST_MAX_ITEMS, `esperava ${personaModule.LIMITS.LIST_MAX_ITEMS}, recebeu ${merged.giriasQuentes.length}`);
});

test('strings vazias na lista são filtradas', () => {
  const merged = personaModule.mergeWithDefaults({ giriasQuentes: ['Bah', '', '   ', 'Show'] });
  assert(merged.giriasQuentes.length === 2, `esperava 2 gírias, recebeu ${merged.giriasQuentes.length}`);
  assert(merged.giriasQuentes.includes('Bah') && merged.giriasQuentes.includes('Show'), 'gírias trimadas perdidas');
});

test('valor não-string é ignorado em string fields', () => {
  const merged = personaModule.mergeWithDefaults({ abertura: 123 });
  assert(merged.abertura === personaModule.DEFAULT_PERSONA.abertura, 'abertura não-string deveria cair pro default');
});

test('valor não-array é ignorado em list fields', () => {
  const merged = personaModule.mergeWithDefaults({ giriasQuentes: 'só uma string' });
  assert(Array.isArray(merged.giriasQuentes), 'lista deveria ser array');
  assert(merged.giriasQuentes.length === personaModule.DEFAULT_PERSONA.giriasQuentes.length, 'deveria cair pro default');
});

// ─── 5. DB integration ───
console.log('\n5. DB integration (com mock)');
test('getPersona() retorna default quando DB vazio', () => {
  mockStorage = {};
  const p = personaModule.getPersona();
  assert(p.abertura === personaModule.DEFAULT_PERSONA.abertura, 'getPersona vazio deveria retornar default');
});

test('JSON inválido no DB cai pro default sem crashar', () => {
  mockStorage = { persona: '{ json invalido aqui' };
  const p = personaModule.getPersona();
  assert(p.abertura === personaModule.DEFAULT_PERSONA.abertura, 'getPersona com JSON inválido deveria cair pro default');
});

test('setPersona() + getPersona() round-trip', () => {
  mockStorage = {};
  personaModule.setPersona({ abertura: 'Custom hello', giriasQuentes: ['Top'] });
  const p = personaModule.getPersona();
  assert(p.abertura === 'Custom hello', 'abertura custom não persistiu');
  assert(p.giriasQuentes.includes('Top'), 'gíria custom não persistiu');
});

test('isPersonaCustom() reflete estado', () => {
  mockStorage = {};
  assert(personaModule.isPersonaCustom() === false, 'sem persona setada, deveria ser false');
  personaModule.setPersona({ abertura: 'test' });
  assert(personaModule.isPersonaCustom() === true, 'após set, deveria ser true');
});

test('resetPersona() volta pro default', () => {
  mockStorage = {};
  personaModule.setPersona({ abertura: 'temp' });
  personaModule.resetPersona();
  assert(!personaModule.isPersonaCustom(), 'após reset, isCustom deveria ser false');
});

// ─── 5b. Snapshot / undo ───
console.log('\n5b. Snapshot e undo (revertPersona)');
test('hasPreviousPersona() é false sem save anterior', () => {
  mockStorage = {};
  assert(personaModule.hasPreviousPersona() === false, 'sem save anterior, deveria ser false');
});

test('save 1ª vez NÃO cria snapshot (não há custom anterior pra guardar)', () => {
  mockStorage = {};
  personaModule.setPersona({ nomeAgente: 'Bruno' });
  assert(!personaModule.hasPreviousPersona(), '1º save sem custom anterior não deveria gerar snapshot');
});

test('save 2ª vez cria snapshot da 1ª save', () => {
  mockStorage = {};
  personaModule.setPersona({ nomeAgente: 'Bruno' });
  personaModule.setPersona({ nomeAgente: 'Carlos' });
  assert(personaModule.hasPreviousPersona(), '2º save deveria criar snapshot');
  const prev = personaModule.getPreviousPersona();
  assert(prev.nomeAgente === 'Bruno', `previous deveria ser Bruno, é "${prev.nomeAgente}"`);
});

test('revertPersona() troca current ↔ previous (undo de undo possível)', () => {
  mockStorage = {};
  personaModule.setPersona({ nomeAgente: 'Bruno' });
  personaModule.setPersona({ nomeAgente: 'Carlos' });
  // Atual: Carlos, anterior: Bruno
  const reverted = personaModule.revertPersona();
  assert(reverted.nomeAgente === 'Bruno', 'revert deveria voltar pro Bruno');
  assert(personaModule.getPersona().nomeAgente === 'Bruno', 'persona atual deveria ser Bruno');
  // Agora anterior deveria ser Carlos (undo de undo)
  const prev = personaModule.getPreviousPersona();
  assert(prev?.nomeAgente === 'Carlos', `previous após revert deveria ser Carlos, é "${prev?.nomeAgente}"`);
});

test('revertPersona() retorna null se não tem previous', () => {
  mockStorage = {};
  const result = personaModule.revertPersona();
  assert(result === null, 'revert sem previous deveria retornar null');
});

test('resetPersona() preserva snapshot do custom anterior', () => {
  mockStorage = {};
  personaModule.setPersona({ nomeAgente: 'Bruno' });
  personaModule.resetPersona();
  assert(personaModule.hasPreviousPersona(), 'resetPersona deveria ter guardado snapshot do Bruno');
  const prev = personaModule.getPreviousPersona();
  assert(prev.nomeAgente === 'Bruno', 'previous após reset deveria ser Bruno');
  // Revert depois do reset
  const reverted = personaModule.revertPersona();
  assert(reverted.nomeAgente === 'Bruno', 'revert pós-reset deveria trazer Bruno de volta');
});

// ─── 6. Estabilidade ───
console.log('\n6. Estabilidade (sem mutação, idempotente)');
test('assembleNucleoV2 não muta input persona', () => {
  const input = { abertura: 'X', giriasQuentes: ['Y'], giriasProibidas: ['Z'], frasesProibidasExtra: [] };
  const snapshot = JSON.stringify(input);
  personaModule.assembleNucleoV2(input);
  assert(JSON.stringify(input) === snapshot, 'input mutado');
});

test('assembleNucleoV2 é determinístico (mesmo input → mesmo output)', () => {
  const a = personaModule.assembleNucleoV2(personaModule.DEFAULT_PERSONA);
  const b = personaModule.assembleNucleoV2(personaModule.DEFAULT_PERSONA);
  assert(a === b, 'assemble não é determinístico');
});

test('DEFAULT_PERSONA é frozen', () => {
  let mutated = false;
  try {
    personaModule.DEFAULT_PERSONA.abertura = 'hack';
    if (personaModule.DEFAULT_PERSONA.abertura === 'hack') mutated = true;
  } catch (e) {
    // strict mode pode jogar TypeError, ok
  }
  assert(!mutated, 'DEFAULT_PERSONA permitiu mutação');
});

// ─── 7. Estrutura preservada ───
console.log('\n7. Estrutura do núcleo preservada (regras imutáveis)');
test('assemble mantém TOPO BLINDADO', () => {
  const out = personaModule.assembleNucleoV2(personaModule.DEFAULT_PERSONA);
  assert(out.includes('TOPO BLINDADO'), 'TOPO BLINDADO ausente');
});

test('assemble mantém MÁQUINA DE ESTADO', () => {
  const out = personaModule.assembleNucleoV2(personaModule.DEFAULT_PERSONA);
  assert(out.includes('MÁQUINA DE ESTADO'), 'MÁQUINA DE ESTADO ausente');
});

test('assemble mantém REGRAS DE OURO', () => {
  const out = personaModule.assembleNucleoV2(personaModule.DEFAULT_PERSONA);
  assert(out.includes('REGRAS DE OURO'), 'REGRAS DE OURO ausente');
});

test('assemble mantém REGRA DOS VALORES', () => {
  const out = personaModule.assembleNucleoV2(personaModule.DEFAULT_PERSONA);
  assert(out.includes('REGRA DOS VALORES'), 'REGRA DOS VALORES ausente');
});

test('assemble mantém ANTI-PADRÃO', () => {
  const out = personaModule.assembleNucleoV2(personaModule.DEFAULT_PERSONA);
  assert(out.includes('ANTI-PADRÃO'), 'ANTI-PADRÃO ausente');
});

test('assemble mantém BLACKLIST ABSOLUTA do sistema', () => {
  const out = personaModule.assembleNucleoV2(personaModule.DEFAULT_PERSONA);
  assert(out.includes('BLACKLIST ABSOLUTA'), 'BLACKLIST ABSOLUTA do sistema ausente');
});

test('assemble mantém CHECAGEM FINAL', () => {
  const out = personaModule.assembleNucleoV2(personaModule.DEFAULT_PERSONA);
  assert(out.includes('CHECAGEM FINAL'), 'CHECAGEM FINAL ausente');
});

test('tamanho do núcleo final ~12-15k chars', () => {
  const out = personaModule.assembleNucleoV2(personaModule.DEFAULT_PERSONA);
  assert(out.length >= 10000 && out.length <= 16000, `tamanho fora do esperado: ${out.length} chars`);
});

// ─── Resumo ───
console.log(`\n[test-persona-assemble] ${pass}/${pass + fail} passou (${fail} falhas)`);
if (fail > 0) {
  console.log('\nFalhas:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.error}`);
  process.exit(1);
}
process.exit(0);
