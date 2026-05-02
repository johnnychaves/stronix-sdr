#!/usr/bin/env node
// Validação Bateria A-E do agent v2 (PR #32) via simulateReplyV2.
// Roda 21 cenários, captura state + tags + tokens, gera scripts/baterias-v2-result.md.
// Asserts objetivos pros 4 cenários da Bateria E.

require('dotenv').config({ override: true });

const fs = require('fs');
const path = require('path');
const { simulateReplyV2 } = require('../src/agent-v2');

// ─── 21 cenários (copia literal de src/admin.js:4823 PG_CENARIOS) ───
const CENARIOS = {
  'A.1 — Lead novo padrão': ['oi, queria saber sobre a academia'],
  'A.2 — Lead pula pra valor': ['oi, qual o valor?'],
  'A.3 — Insiste em valor (3x)': ['qual o valor?', 'quanto custa?', 'me passa os valores aí'],
  'A.4 — Qualificação completa': ['oi', 'tô parado faz tempo', 'quero emagrecer', 'Maria', 'manhã', 'terça', '9h'],
  'B.1 — Tá caro': ['oi quanto custa', 'qual o valor', 'me passa os valores', 'tá caro pra mim'],
  'B.2 — Vou pensar': ['oi tudo bem? me conta sobre os planos', 'ah vou pensar e te falo'],
  'B.3 — Mês que vem': ['oi quero treinar', 'vou começar no próximo mês, tô me organizando'],
  'B.4 — Gympass': ['vocês atendem Gympass?'],
  'B.5 — Mensal': ['oi quero treinar', 'tô parado', 'emagrecer', 'João', 'manhã', 'quero só o plano mensal'],
  'C.1 — Gestante': ['oi tô grávida, posso treinar?'],
  'C.2 — Idoso': ['tenho 67 anos, vocês atendem idoso?'],
  'C.3 — Lesão': ['fiz cirurgia no joelho ano passado, posso treinar?'],
  'D.1 — É IA?': ['oi, você é robô?'],
  'D.2 — Lead aluno (financeiro)': ['oi minha mensalidade não foi descontada'],
  'D.3 — Grosseria': ['isso é uma porcaria, vocês são uns ladrões'],
  'D.4 — Errou número': ['oi mãe, tô chegando'],
  'E.1 — Mudança de objeção (reset contador)': ['oi quero saber valores', 'qual o valor', 'qual o valor', 'tá caro', 'mas eu preciso falar com minha esposa'],
  'E.2 — 3 tentativas mesma objeção (handoff)': ['oi', 'tá caro', 'tá muito caro', 'sério mesmo, tá caro pra mim'],
  'E.3 — Conversa longa (>15 msgs)': ['oi', 'tô parado', 'quero saúde', 'João', 'tarde', 'quarta', '14h', 'beleza confirmado', 'aliás, tem estacionamento?', 'e vestiário?', 'qual o horário?', 'aceita Pix?', 'tem aula de zumba?', 'meu joelho dói às vezes', 'preciso adiar pra outra semana'],
  'E.4 — Tag malformada (resiliência)': ['oi qual valor'],
};

// ─── Asserts objetivos da Bateria E ───
const ASSERTS_E = {
  'E.1 — Mudança de objeção (reset contador)': (r) => {
    const s = r.finalState;
    const objs = Array.isArray(s?.objecoes_levantadas) ? s.objecoes_levantadas : [];
    if (objs.length < 2) throw new Error(`objecoes_levantadas deveria ter 2+ entradas, tem ${objs.length}: ${JSON.stringify(objs)}`);
    if ((s?.tentativas_objecao_atual ?? -1) !== 0) throw new Error(`tentativas_objecao_atual deveria ser 0 após mudança de objeção, é ${s?.tentativas_objecao_atual}`);
  },
  'E.2 — 3 tentativas mesma objeção (handoff)': (r) => {
    const s = r.finalState;
    if (s?.estagio_atual !== 'handoff_humano') throw new Error(`estagio_atual deveria ser 'handoff_humano', é '${s?.estagio_atual}'`);
    if ((s?.tentativas_objecao_atual ?? 0) !== 3) throw new Error(`tentativas_objecao_atual deveria ser 3, é ${s?.tentativas_objecao_atual}`);
  },
  'E.3 — Conversa longa (>15 msgs)': (r) => {
    // Após o turno 8 ("beleza confirmado"), agendamento deveria estar capturado
    // Aceita capturar até o final da conversa (turnos 9-15 são perguntas extras pós-confirmação)
    const turn8 = r.turns[7]; // 0-indexed
    if (!turn8) throw new Error('conversa não chegou ao turno 8');
    const lastWithAg = r.turns.find(t => t.parsed?.agendamento && Object.keys(t.parsed.agendamento).length > 0);
    if (!lastWithAg) throw new Error('nenhum turno emitiu tag [AGENDAMENTO:...]');
    const ag = lastWithAg.parsed.agendamento;
    if (!ag.dia) throw new Error(`tag [AGENDAMENTO] sem campo dia: ${JSON.stringify(ag)}`);
    if (!ag.hora) throw new Error(`tag [AGENDAMENTO] sem campo hora: ${JSON.stringify(ag)}`);
  },
  'E.4 — Tag malformada (resiliência)': (r) => {
    for (const t of r.turns) {
      if (/\[ESTADO:/i.test(t.ai)) throw new Error(`resposta contém literal [ESTADO: — parser falhou: "${t.ai.slice(0,80)}"`);
      if (/\[MODULO_REQUERIDO:/i.test(t.ai)) throw new Error(`resposta contém literal [MODULO_REQUERIDO: — parser falhou`);
      if (/\[AGENDAMENTO:/i.test(t.ai)) throw new Error(`resposta contém literal [AGENDAMENTO: — parser falhou`);
    }
  },
};

// ─── Roda um cenário ───
async function runCenario(name, msgs) {
  const turns = [];
  let history = [];
  let state = null;
  for (const userMsg of msgs) {
    const result = await simulateReplyV2(history, userMsg, state);
    turns.push({
      user: userMsg,
      ai: result.text,
      state: result.state,
      parsed: result.parsed,
      tokensInput: result.tokensInput,
      tokensOutput: result.tokensOutput,
      cacheReadTokens: result.cacheReadTokens,
      cacheCreationTokens: result.cacheCreationTokens,
      latencyMs: result.latencyMs,
    });
    history.push({ role: 'user', content: userMsg });
    history.push({ role: 'assistant', content: result.text });
    state = result.state;
  }
  return { name, msgs, turns, finalState: state };
}

// ─── Renderiza relatório markdown ───
function renderReport(results, totals) {
  const lines = [];
  const now = new Date().toISOString();
  lines.push('# Relatório Bateria A-E — agent v2 (PR #32)');
  lines.push('');
  lines.push(`> Gerado: ${now}`);
  lines.push(`> Modelo: claude-sonnet-4-5-20250929`);
  lines.push('');

  // Sumário
  const eResults = results.filter(r => r.assertResult !== undefined);
  const ePass = eResults.filter(r => r.assertResult?.pass).length;
  const crashes = results.filter(r => r.error).length;
  // Anthropic SDK: input_tokens já EXCLUI cache_read_input_tokens (são contadores separados).
  const costUSD = (
    totals.totalIn * 3 / 1_000_000 +
    totals.totalCacheRead * 0.30 / 1_000_000 +
    totals.totalOut * 15 / 1_000_000
  );
  lines.push('## Sumário');
  lines.push('');
  lines.push(`- Cenários rodados: ${results.length}/21`);
  lines.push(`- Bateria E: **${ePass}/${eResults.length} passou**`);
  lines.push(`- Crashes: ${crashes}`);
  lines.push(`- Tokens — input: ${totals.totalIn} (cache read: ${totals.totalCacheRead}), output: ${totals.totalOut}`);
  lines.push(`- Latência total: ${(totals.totalLatency/1000).toFixed(1)}s · média/turno: ${(totals.totalLatency/totals.totalCalls).toFixed(0)}ms`);
  lines.push(`- Custo estimado: $${costUSD.toFixed(4)} (~R$ ${(costUSD * 5.5).toFixed(2)})`);
  lines.push('');

  // Falhas da Bateria E primeiro (visibilidade)
  const eFails = eResults.filter(r => !r.assertResult?.pass);
  if (eFails.length) {
    lines.push('## ❌ Falhas Bateria E');
    lines.push('');
    for (const r of eFails) {
      lines.push(`- **${r.name}**: ${r.assertResult.reason}`);
    }
    lines.push('');
  }

  // Crashes
  if (crashes) {
    lines.push('## 💥 Crashes');
    lines.push('');
    for (const r of results.filter(r => r.error)) {
      lines.push(`- **${r.name}**: ${r.error}`);
      if (r.stack) lines.push('  ```\n  ' + r.stack.split('\n').slice(0,3).join('\n  ') + '\n  ```');
    }
    lines.push('');
  }

  // Detalhe por cenário
  lines.push('## Detalhe por cenário');
  lines.push('');
  for (const r of results) {
    lines.push(`### ${r.name}`);
    lines.push('');
    if (r.error) {
      lines.push(`**CRASH:** ${r.error}`);
      lines.push('');
      continue;
    }
    if (r.assertResult) {
      lines.push(`**Assert:** ${r.assertResult.pass ? '✅ PASS' : '❌ FAIL — ' + r.assertResult.reason}`);
      lines.push('');
    }
    for (let i = 0; i < r.turns.length; i++) {
      const t = r.turns[i];
      lines.push(`**Turno ${i+1}**`);
      lines.push('');
      lines.push(`- 👤 user: \`${t.user}\``);
      lines.push(`- 🤖 ai: ${t.ai.split('\n').map(l => `> ${l}`).join('\n')}`);
      const tags = [];
      if (t.parsed?.stateFields && Object.keys(t.parsed.stateFields).length) tags.push(`stateFields=${JSON.stringify(t.parsed.stateFields)}`);
      if (t.parsed?.nameFromTag) tags.push(`nome="${t.parsed.nameFromTag}"`);
      if (t.parsed?.requiredModule) tags.push(`módulo="${t.parsed.requiredModule}"`);
      if (t.parsed?.agendamento) tags.push(`agendamento=${JSON.stringify(t.parsed.agendamento)}`);
      if (tags.length) lines.push(`- 🏷️ ${tags.join(' · ')}`);
      lines.push(`- ⏱️ ${t.latencyMs}ms · in:${t.tokensInput} (cache:${t.cacheReadTokens}) out:${t.tokensOutput}`);
      lines.push('');
    }
    const fs = r.finalState;
    if (fs) {
      lines.push('**Estado final:**');
      lines.push('```json');
      lines.push(JSON.stringify({
        estagio_atual: fs.estagio_atual,
        proxima_acao: fs.proxima_acao,
        insistencias_valor: fs.insistencias_valor,
        objetivo: fs.objetivo,
        modalidade_recomendada: fs.modalidade_recomendada,
        disponibilidade: fs.disponibilidade,
        objecao_ativa: fs.objecao_ativa,
        objecoes_levantadas: fs.objecoes_levantadas,
        tentativas_objecao_atual: fs.tentativas_objecao_atual,
        modulo_pendente: fs.modulo_pendente,
        aula_experimental_agendada: fs.aula_experimental_agendada,
        data_agendamento: fs.data_agendamento,
        hora_agendamento: fs.hora_agendamento,
      }, null, 2));
      lines.push('```');
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Main ───
async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ERRO: ANTHROPIC_API_KEY não definida no .env');
    process.exit(1);
  }
  console.log('[baterias-v2] iniciando — 21 cenários\n');

  const results = [];
  const totals = { totalIn: 0, totalOut: 0, totalCacheRead: 0, totalLatency: 0, totalCalls: 0 };

  for (const [name, msgs] of Object.entries(CENARIOS)) {
    process.stdout.write(`  ${name.padEnd(50)} ... `);
    try {
      const r = await runCenario(name, msgs);
      for (const t of r.turns) {
        totals.totalIn += t.tokensInput || 0;
        totals.totalOut += t.tokensOutput || 0;
        totals.totalCacheRead += t.cacheReadTokens || 0;
        totals.totalLatency += t.latencyMs || 0;
        totals.totalCalls++;
      }
      if (ASSERTS_E[name]) {
        try {
          ASSERTS_E[name](r);
          r.assertResult = { pass: true };
          console.log(`✓ (${r.turns.length} turnos)`);
        } catch (e) {
          r.assertResult = { pass: false, reason: e.message };
          console.log(`✗ ${e.message}`);
        }
      } else {
        console.log(`ok (${r.turns.length} turnos)`);
      }
      results.push(r);
    } catch (err) {
      console.log(`💥 ${err.message}`);
      results.push({ name, error: err.message, stack: err.stack, turns: [] });
    }
  }

  const md = renderReport(results, totals);
  const outPath = path.join(__dirname, 'baterias-v2-result.md');
  fs.writeFileSync(outPath, md);

  const eResults = results.filter(r => r.assertResult !== undefined);
  const ePass = eResults.filter(r => r.assertResult?.pass).length;
  const costUSD = (
    totals.totalIn * 3 / 1_000_000 +
    totals.totalCacheRead * 0.30 / 1_000_000 +
    totals.totalOut * 15 / 1_000_000
  );

  console.log(`\n─────────────────────────────────────────`);
  console.log(`Bateria E: ${ePass}/${eResults.length} passou`);
  console.log(`Custo total: $${costUSD.toFixed(4)} (~R$ ${(costUSD * 5.5).toFixed(2)})`);
  console.log(`Relatório: scripts/baterias-v2-result.md`);
  process.exit(ePass === eResults.length ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
