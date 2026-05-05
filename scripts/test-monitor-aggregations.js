#!/usr/bin/env node
// Smoke test do Monitor unificado v2 × v3 (PR #66).
//
// Cobre:
// 1. Hash determinístico de phone — mesmo phone, mesmo bucket sempre.
// 2. Phone-locked: phone que cai em v3 com pct=20 continua em v3 com pct=50.
// 3. Distribuição uniforme — 1000 phones com pct=10 ficam em [85, 115].
// 4. Override de admin tem prioridade absoluta sobre rollout.
// 5. env=v2 ignora rollout (force-rollback total via env).
// 6. getMetrics filtra eventos por versão correta (TURN_OK vs TURN_OK_V3).
// 7. getAlerts dispara preco_fora_referencia_v3 com 1+ ocorrência.
// 8. getAlerts dispara tool_call_ausente_alta em >5% (com floor de 20 turnos).
// 9. getCostMetrics agrega tokens só de events com meta válida.
// 10. getConversations filtra por versão derivada do último TURN_OK[/V3].
//
// Roda standalone: `node scripts/test-monitor-aggregations.js`.

const path = require('path');
const fs = require('fs');
const os = require('os');

// DB temp — antes de require('../src/db'). DB_PATH com 'test-' bypassa o
// loop de notificação de alertas (admin.js).
const tmpDb = path.join(os.tmpdir(), `test-monitor-${process.pid}.sqlite`);
process.env.DB_PATH = tmpDb;
process.on('exit', () => { try { fs.unlinkSync(tmpDb); } catch (_) {} });

const db = require('../src/db');

let pass = 0, fail = 0;
const failures = [];

function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; failures.push({ name, error: e.message }); console.log(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('\n[test-monitor-aggregations] iniciando\n');

// ─── 1. Hash determinístico ───
console.log('  ── Hash phone-locked ──');

test('Mesmo phone → mesmo bucket sempre', () => {
  // Limpa override + rollout pra teste limpo
  db.setRuntimeFlag('agent_version_override', '');
  db.setRuntimeFlag('v3_rollout_pct', '10');
  const v1 = db.getAgentVersionForPhone('5551995304633', 'v3');
  const v2 = db.getAgentVersionForPhone('5551995304633', 'v3');
  const v3 = db.getAgentVersionForPhone('5551995304633', 'v3');
  assert(v1 === v2 && v2 === v3, `inconsistente: ${v1}/${v2}/${v3}`);
});

test('Phone que cai em v3 com pct=20 continua em v3 com pct=50', () => {
  // Encontra um phone que cai em v3 com pct=20
  let targetPhone = null;
  for (let i = 0; i < 200; i++) {
    db.setRuntimeFlag('v3_rollout_pct', '20');
    const phone = '555199' + String(1000000 + i).padStart(7, '0');
    if (db.getAgentVersionForPhone(phone, 'v3') === 'v3') {
      targetPhone = phone;
      break;
    }
  }
  assert(targetPhone, 'nenhum phone caiu em v3 com pct=20 nas 200 tentativas (improvável)');
  // Aumenta pra pct=50 — bucket NÃO muda, então continua em v3
  db.setRuntimeFlag('v3_rollout_pct', '50');
  assert(db.getAgentVersionForPhone(targetPhone, 'v3') === 'v3', `phone ${targetPhone} migrou de v3 quando pct subiu`);
  // Reduz pra pct=20 — continua em v3
  db.setRuntimeFlag('v3_rollout_pct', '20');
  assert(db.getAgentVersionForPhone(targetPhone, 'v3') === 'v3', `phone ${targetPhone} migrou quando pct voltou`);
});

test('Distribuição uniforme: 1000 phones com pct=10 caem [85,115]', () => {
  db.setRuntimeFlag('agent_version_override', '');
  db.setRuntimeFlag('v3_rollout_pct', '10');
  let countV3 = 0;
  for (let i = 0; i < 1000; i++) {
    const phone = '555198' + String(1000000 + i).padStart(7, '0');
    if (db.getAgentVersionForPhone(phone, 'v3') === 'v3') countV3++;
  }
  assert(countV3 >= 85 && countV3 <= 115, `count=${countV3} fora de [85,115] — hash uniforme falhou`);
});

test('Override admin tem prioridade absoluta sobre rollout', () => {
  db.setRuntimeFlag('v3_rollout_pct', '50');
  db.setRuntimeFlag('agent_version_override', 'v1');
  assert(db.getAgentVersionForPhone('555199xxxxxx', 'v3') === 'v1', 'override v1 não foi respeitado');
  db.setRuntimeFlag('agent_version_override', 'v2');
  assert(db.getAgentVersionForPhone('555199xxxxxx', 'v3') === 'v2', 'override v2 não foi respeitado');
  db.setRuntimeFlag('agent_version_override', '');
});

test('env=v2 ignora rollout (force-rollback total)', () => {
  db.setRuntimeFlag('agent_version_override', '');
  db.setRuntimeFlag('v3_rollout_pct', '100');
  const v = db.getAgentVersionForPhone('555199xxxxxx', 'v2');
  assert(v === 'v2', `env=v2 + pct=100 devia ser v2, foi ${v}`);
});

test('env=v3 + pct=0 → todo mundo em v2', () => {
  db.setRuntimeFlag('agent_version_override', '');
  db.setRuntimeFlag('v3_rollout_pct', '0');
  for (let i = 0; i < 50; i++) {
    const phone = '555197' + String(2000000 + i).padStart(7, '0');
    assert(db.getAgentVersionForPhone(phone, 'v3') === 'v2', `pct=0 + phone ${phone} caiu em v3`);
  }
});

test('env=v3 + pct=100 → todo mundo em v3', () => {
  db.setRuntimeFlag('v3_rollout_pct', '100');
  for (let i = 0; i < 50; i++) {
    const phone = '555197' + String(3000000 + i).padStart(7, '0');
    assert(db.getAgentVersionForPhone(phone, 'v3') === 'v3', `pct=100 + phone ${phone} caiu em v2`);
  }
});

// ─── 2. getMetrics ───
console.log('\n  ── getMetrics filtra por versão ──');

test('getMetrics aceita só v2 ou v3', () => {
  let threw = false;
  try { db.getMetrics('7d', 'v1'); } catch { threw = true; }
  assert(threw, 'devia ter lançado pra version=v1');
});

test('getMetrics(v2) usa TURN_OK no denominador', () => {
  // Setup: 5 TURN_OK + 1 TAG_ESQUECIDA + 3 TURN_OK_V3 (não devem entrar)
  for (let i = 0; i < 5; i++) db.logV2Event('turn_ok', '5551' + i, null, { tokensInput: 100 });
  db.logV2Event('tag_esquecida', '55512', null);
  for (let i = 0; i < 3; i++) db.logV2Event('turn_ok_v3', '5552' + i, null);

  const m = db.getMetrics('7d', 'v2');
  // Deve contar 5 turn_ok + 1 tag_esquecida = 6 turnos v2
  assert(m.total_turns === 6, `total_turns deveria ser 6 (5 ok + 1 esquecida), foi ${m.total_turns}`);
  // % tag missing = 1/6 = 16.67%
  assert(m.pct_tag_missing > 16 && m.pct_tag_missing < 17, `pct_tag_missing inesperado: ${m.pct_tag_missing}`);
});

test('getMetrics(v3) usa TURN_OK_V3 + TOOL_CALL_AUSENTE', () => {
  for (let i = 0; i < 8; i++) db.logV2Event('turn_ok_v3', '55598' + i, null);
  db.logV2Event('tool_call_ausente', '555980', null);

  const m = db.getMetrics('7d', 'v3');
  // Deve contar 8 v3 + 1 ausente = 9 turnos. (Setup acima também tem 3 v3 → 11+1=12)
  assert(m.total_turns >= 9, `total_turns v3 deveria ser >=9, foi ${m.total_turns}`);
});

// ─── 3. getAlerts ───
console.log('\n  ── getAlerts ──');

test('getAlerts(v3) dispara preco_fora_referencia_v3 com 1+ ocorrência', () => {
  db.logV2Event('preco_fora_referencia_v3', '555199', null, { reason: 'test' });
  const alerts = db.getAlerts('v3');
  const found = alerts.find(a => a.code === 'preco_fora_referencia_v3');
  assert(found, 'alerta preco_fora_referencia_v3 não disparou');
  assert(found.level === 'critical', 'devia ser critical');
});

test('getAlerts(v3) dispara tool_call_multiple com 1+ ocorrência', () => {
  db.logV2Event('tool_call_multiple', '555200', null, { count: 2 });
  const alerts = db.getAlerts('v3');
  const found = alerts.find(a => a.code === 'tool_call_multiple');
  assert(found, 'alerta tool_call_multiple não disparou');
});

test('getAlerts(v3) tool_call_ausente_alta exige floor de 20 turnos', () => {
  // Já temos ~12 v3 + 1 ausente. Adiciona mais pra passar floor=20.
  for (let i = 0; i < 10; i++) db.logV2Event('turn_ok_v3', '55599' + i, null);
  for (let i = 0; i < 5; i++) db.logV2Event('tool_call_ausente', '55599a' + i, null);
  // Total: ~22 v3 + 6 ausentes = 28. 6/28 = 21% (>5%). Deve disparar.
  const alerts = db.getAlerts('v3');
  const found = alerts.find(a => a.code === 'tool_call_ausente_alta');
  assert(found, 'alerta tool_call_ausente_alta não disparou (esperava com 6/28=21%)');
});

// ─── 4. getCostMetrics ───
console.log('\n  ── getCostMetrics ──');

test('getCostMetrics agrega tokens só de events com meta válida', () => {
  // Os 5 turn_ok do teste de v2 acima foram logados com { tokensInput: 100 }.
  // tokensOutput/cache não foram setados → ficam 0.
  const cost = db.getCostMetrics('7d', 'v2');
  // 5 turnos × 100 tokens input × $3/M = $0.0015
  assert(cost.tokens.input >= 500, `tokens.input deveria ser >=500, foi ${cost.tokens.input}`);
  assert(cost.cost_usd > 0, 'cost_usd deveria ser >0');
  assert(cost.coverage_pct > 0, 'coverage_pct deveria ser >0');
});

test('getCostMetrics retorna 0 quando não há tokens em meta', () => {
  // turn_ok_v3 dos testes anteriores foram logados sem tokens.
  const cost = db.getCostMetrics('7d', 'v3');
  // Coverage deveria ser baixa (turnos sem cost_data)
  assert(cost.tokens.input === 0, `tokens.input v3 deveria ser 0, foi ${cost.tokens.input}`);
  assert(cost.cost_usd === 0, 'cost_usd v3 deveria ser 0');
});

test('CLAUDE_PRICING_USD_PER_M tem 4 entries', () => {
  const p = db.CLAUDE_PRICING_USD_PER_M;
  assert(p.input > 0 && p.output > 0 && p.cache_read > 0 && p.cache_creation > 0, 'pricing incompleto');
  assert(p.cache_read < p.input, 'cache_read deveria ser menor que input');
});

// ─── 5. getConversations com filtro de versão ───
console.log('\n  ── getConversations filtra por versão ──');

test('getConversations sem filtro retorna lista', () => {
  // Cria contatos + lead_state pros phones que tiveram TURN_OK*
  db.getOrCreateContact('5551111');
  db.getOrCreateLeadState('5551111');
  db.logV2Event('turn_ok', '5551111', null, { tokensInput: 50 });

  db.getOrCreateContact('5552222');
  db.getOrCreateLeadState('5552222');
  db.logV2Event('turn_ok_v3', '5552222', null);

  const all = db.getConversations({ limit: 500 });
  assert(all.length >= 2, `esperava >=2 conversas, veio ${all.length}`);
});

test('getConversations({version: v2}) só retorna phones v2', () => {
  const v2only = db.getConversations({ version: 'v2', limit: 500 });
  for (const c of v2only) {
    assert(c._version === 'v2', `phone ${c.phone} tem _version=${c._version} mas filtro era v2`);
  }
});

test('getConversations({version: v3}) só retorna phones v3', () => {
  const v3only = db.getConversations({ version: 'v3', limit: 500 });
  for (const c of v3only) {
    assert(c._version === 'v3', `phone ${c.phone} tem _version=${c._version} mas filtro era v3`);
  }
});

// ─── Resultado ───
console.log(`\n[test-monitor-aggregations] resultado: ${pass} pass, ${fail} fail\n`);
if (fail > 0) {
  console.log('Falhas:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.error}`);
  process.exit(1);
}
process.exit(0);
