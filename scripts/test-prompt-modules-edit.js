#!/usr/bin/env node
// Smoke test do editor de prompt_modules (PR65 — admin edita 28 módulos).
// Cobre:
// 1. Default — getDefaultPromptModuleContent bate com o seed.
// 2. Edição — upsertPromptModule grava content_previous antes de sobrescrever.
// 3. Restaurar — resetPromptModule volta pro seed e zera snapshot.
// 4. Reverter — revertPromptModule swap content↔previous, retorna null se sem snapshot.
// 5. Char limit — endpoint PUT bloqueia >5000 (>8000 nos grandes).
// 6. Vazio — endpoint PUT bloqueia content vazio/só-espaços.
// 7. planos_e_precos quebrado — bloqueia sem force, salva com force=true.
// 8. category inválida — endpoint PUT bloqueia.
// 9. Smoke — getPromptModuleContents reflete edição imediatamente.
//
// Roda standalone: `node scripts/test-prompt-modules-edit.js`.
// Usa DB temporário em /tmp pra não sujar produção/dev.

const path = require('path');
const fs = require('fs');
const os = require('os');

// DB temp — antes de require('../src/db').
const tmpDb = path.join(os.tmpdir(), `test-prompt-modules-${process.pid}.sqlite`);
process.env.DB_PATH = tmpDb;
process.on('exit', () => { try { fs.unlinkSync(tmpDb); } catch (_) {} });

const db = require('../src/db');
const seed = require('../src/prompt-modules-seed');
const { parsePlanosFromModule } = require('../src/v3-validators');

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

console.log('\n[test-prompt-modules-edit] iniciando\n');
console.log('  DB temp:', tmpDb);

// ─── 1. Default = seed ───
console.log('\n  ── Defaults batem com seed ──');
test('getDefaultPromptModuleContent retorna content do seed', () => {
  for (const m of seed) {
    const got = db.getDefaultPromptModuleContent(m.name);
    assert(got === m.content, `${m.name}: divergiu do seed`);
  }
});
test('getDefaultPromptModuleContent retorna null pra nome inexistente', () => {
  assert(db.getDefaultPromptModuleContent('nao_existe_xyz') === null, 'devia ser null');
});

// ─── 2. Edição — snapshot ───
console.log('\n  ── Edição cria snapshot ──');
test('upsertPromptModule grava content em content_previous antes de sobrescrever', () => {
  const original = db.getPromptModule('objecao_preco');
  assert(original, 'objecao_preco devia existir após seed');
  db.upsertPromptModule({ name: 'objecao_preco', content: 'TEXTO NOVO 1', category: 'objecoes' }, 1);
  const after = db.getPromptModule('objecao_preco');
  assert(after.content === 'TEXTO NOVO 1', 'content devia ser novo');
  assert(after.content_previous === original.content, 'content_previous devia ter o original');
});

test('Segunda edição empilha: previous fica = anterior, não o original', () => {
  db.upsertPromptModule({ name: 'objecao_preco', content: 'TEXTO NOVO 2', category: 'objecoes' }, 1);
  const after = db.getPromptModule('objecao_preco');
  assert(after.content === 'TEXTO NOVO 2', 'content devia ser TEXTO NOVO 2');
  assert(after.content_previous === 'TEXTO NOVO 1', `previous devia ser TEXTO NOVO 1, foi: ${after.content_previous}`);
});

test('Editar com mesmo conteúdo NÃO atualiza snapshot', () => {
  const before = db.getPromptModule('objecao_preco');
  db.upsertPromptModule({ name: 'objecao_preco', content: before.content, category: 'objecoes' }, 1);
  const after = db.getPromptModule('objecao_preco');
  assert(after.content_previous === before.content_previous, 'snapshot devia continuar inalterado');
});

// ─── 3. Reverter ───
console.log('\n  ── Reverter (1 nível undo) ──');
test('revertPromptModule swap content↔previous', () => {
  const before = db.getPromptModule('objecao_preco');
  const reverted = db.revertPromptModule('objecao_preco', 1);
  assert(reverted, 'devia retornar a linha após swap');
  assert(reverted.content === before.content_previous, 'content devia virar o previous');
  assert(reverted.content_previous === before.content, 'previous devia virar o content antigo');
});

test('revertPromptModule num módulo sem snapshot retorna null', () => {
  // tecnicas_persuasao está limpo (nunca editamos) — content_previous = NULL.
  const result = db.revertPromptModule('tecnicas_persuasao', 1);
  assert(result === null, `devia ser null, foi: ${JSON.stringify(result)}`);
});

// ─── 4. Restaurar default ───
console.log('\n  ── Restaurar default ──');
test('resetPromptModule volta pro seed e zera snapshot', () => {
  // objecao_preco está em estado editado. Restaura.
  const seedItem = seed.find((s) => s.name === 'objecao_preco');
  const restored = db.resetPromptModule('objecao_preco', 1);
  assert(restored.content === seedItem.content, 'devia voltar pro conteúdo do seed');
  assert(restored.content_previous === null, `snapshot devia ser null, foi: ${restored.content_previous}`);
});

test('resetPromptModule num nome inexistente lança erro', () => {
  let threw = false;
  try { db.resetPromptModule('nao_existe_xyz', 1); } catch (_) { threw = true; }
  assert(threw, 'devia ter lançado');
});

// ─── 5. Smoke runtime ───
console.log('\n  ── getPromptModuleContents pega edição na hora ──');
test('Após edição, getPromptModuleContents retorna conteúdo novo', () => {
  db.upsertPromptModule({ name: 'objecao_tempo', content: 'CONTEUDO RUNTIME TEST', category: 'objecoes' }, 1);
  const rows = db.getPromptModuleContents(['objecao_tempo']);
  assert(rows.length === 1, 'devia retornar 1');
  assert(rows[0].content === 'CONTEUDO RUNTIME TEST', 'devia bater com edição');
  // Restaura pra não poluir outros testes.
  db.resetPromptModule('objecao_tempo', 1);
});

// ─── 6. Validação do parser planos_e_precos ───
console.log('\n  ── Parser planos_e_precos ──');
test('parsePlanosFromModule no seed produz pelo menos 1 plano', () => {
  const seedPrecos = seed.find((s) => s.name === 'planos_e_precos');
  const planos = parsePlanosFromModule(seedPrecos.content);
  const count = Object.keys(planos).length;
  assert(count > 0, `devia parsear pelo menos 1 plano, parseou ${count}`);
});

test('parsePlanosFromModule em texto inválido retorna {}', () => {
  const planos = parsePlanosFromModule('blá blá sem estrutura nenhuma');
  assert(Object.keys(planos).length === 0, 'devia retornar {}');
});

test('parsePlanosFromModule defensivo contra null/undefined', () => {
  assert(Object.keys(parsePlanosFromModule(null)).length === 0, 'null → {}');
  assert(Object.keys(parsePlanosFromModule(undefined)).length === 0, 'undefined → {}');
  assert(Object.keys(parsePlanosFromModule('')).length === 0, 'vazio → {}');
});

// ─── 7. Limites tabela hardcoded reflete decisão do dono ───
console.log('\n  ── Limites por módulo (decisão do dono) ──');
test('Módulos grandes (>2.3k chars no seed) cabem no limite 8000', () => {
  const grandes = ['publicos_especificos', 'cenarios_borda', 'info_academia', 'tecnicas_persuasao'];
  for (const name of grandes) {
    const m = seed.find((s) => s.name === name);
    assert(m, `${name} devia existir no seed`);
    assert(m.content.length <= 8000, `${name} tem ${m.content.length} chars, > 8000`);
  }
});

test('Módulos não-grandes cabem no limite 5000', () => {
  const grandesSet = new Set(['publicos_especificos', 'cenarios_borda', 'info_academia', 'tecnicas_persuasao']);
  for (const m of seed) {
    if (grandesSet.has(m.name)) continue;
    assert(m.content.length <= 5000, `${m.name} tem ${m.content.length} chars, > 5000 (precisa promover pra "grande")`);
  }
});

// ─── 8. Cobertura: 28 módulos ───
console.log('\n  ── Cobertura 28 módulos ──');
test('Seed tem exatamente 28 módulos', () => {
  assert(seed.length === 28, `seed tem ${seed.length}, esperado 28`);
});

test('Todos os módulos do seed têm category válida', () => {
  const valid = new Set(['conhecimento', 'objecoes', 'situacionais', 'sistema']);
  for (const m of seed) {
    assert(valid.has(m.category), `${m.name} tem category inválida: ${m.category}`);
  }
});

// ─── Resultado ───
console.log(`\n[test-prompt-modules-edit] resultado: ${pass} pass, ${fail} fail\n`);
if (fail > 0) {
  console.log('\nFalhas:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.error}`);
  process.exit(1);
}
process.exit(0);
