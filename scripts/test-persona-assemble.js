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
  assert(/\{\{PERSONA_ABERTURA\}\}/.test(NUCLEO_TEMPLATE), 'template sem {{PERSONA_ABERTURA}}');
  assert(/\{\{PERSONA_GIRIAS_QUENTES\}\}/.test(NUCLEO_TEMPLATE), 'template sem {{PERSONA_GIRIAS_QUENTES}}');
  assert(/\{\{PERSONA_GIRIAS_PROIBIDAS\}\}/.test(NUCLEO_TEMPLATE), 'template sem {{PERSONA_GIRIAS_PROIBIDAS}}');
  assert(/\{\{PERSONA_FRASES_PROIBIDAS_EXTRA_BLOCK\}\}/.test(NUCLEO_TEMPLATE), 'template sem {{PERSONA_FRASES_PROIBIDAS_EXTRA_BLOCK}}');
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
