#!/usr/bin/env node
// Seed de 5 conversas v2 sintéticas pra testar a tela de monitoramento
// ANTES de ligar AGENT_VERSION=v2 em produção. Critério de aceitação do PR37.
//
// Cobre: em_andamento, agendou, handoff, perdeu, com tag esquecida.
// Phones usam prefixo 99999 + DEV pra não colidir com leads reais.
//
// Uso: node scripts/seed-v2-test-conversations.js
// Cleanup: node scripts/seed-v2-test-conversations.js --clean

require('dotenv').config({ override: true });
const db = require('../src/db');

const FAKE_PREFIX = '5599999000';
// IDs numéricos pra phone ser válido (só dígitos)
const PHONE_IDS = {
  em_andamento: '00001',
  agendou: '00002',
  handoff: '00003',
  perdeu: '00004',
  tag_esquecida: '00005',
};
const SCENARIOS = [
  {
    id: 'em_andamento',
    name: 'Mariana (em andamento)',
    estagio: 'qualificacao_objetivo',
    msgs: [
      { role: 'user', content: 'oi quero saber sobre a academia', minsAgo: 30 },
      { role: 'assistant', content: '[ESTADO:estagio=qualificacao_inicial|nome=|objetivo=|modalidade=|disponibilidade=|insistencias_valor=0|objecao_ativa=]\nOpa beleza! Sou o Johnny da STRONIX 👋\n\nTu tá treinando ou parado no momento?', minsAgo: 30 },
      { role: 'user', content: 'tô parado faz uns 6 meses', minsAgo: 25 },
      { role: 'assistant', content: '[ESTADO:estagio=qualificacao_objetivo|proxima_acao=perguntar_objetivo|insistencias_valor=0|objetivo=|modalidade=|disponibilidade=|objecao_ativa=]\nSaquei! E me diz uma coisa: tu busca mais resultado físico (massa, emagrecer) ou qualidade de vida no dia a dia?', minsAgo: 25 },
    ],
    state: { estagio_atual: 'qualificacao_objetivo', insistencias_valor: 0 },
  },
  {
    id: 'agendou',
    name: 'João (agendou aula experimental)',
    estagio: 'agendamento_confirmado',
    msgs: [
      { role: 'user', content: 'queria saber sobre musculação', minsAgo: 180 },
      { role: 'assistant', content: '[ESTADO:estagio=qualificacao_inicial|nome=|objetivo=|modalidade=|disponibilidade=|insistencias_valor=0|objecao_ativa=]\nOpa João, beleza! Tu tá treinando ou parado?', minsAgo: 180 },
      { role: 'user', content: 'parado, quero ganhar massa', minsAgo: 170 },
      { role: 'assistant', content: '[ESTADO:estagio=captura_nome|objetivo=massa]\nMassa! E o nome aí?', minsAgo: 170 },
      { role: 'user', content: 'João', minsAgo: 165 },
      { role: 'assistant', content: '[ESTADO:estagio=recomendacao_modalidade|nome=João|objetivo=massa|modalidade=musculacao]\nBeleza João! Pra ganhar massa, recomendo Musculação. Tu prefere manhã ou tarde?', minsAgo: 165 },
      { role: 'user', content: 'manhã', minsAgo: 160 },
      { role: 'assistant', content: '[ESTADO:estagio=proposta_visita|disponibilidade=manha]\nShow. Tenho terça ou quarta de manhã pra primeira aula gratuita. Qual rola?', minsAgo: 160 },
      { role: 'user', content: 'terça às 9h', minsAgo: 155 },
      { role: 'assistant', content: '[ESTADO:estagio=agendamento_confirmado|data_agendamento=terça|hora_agendamento=9h]\n[AGENDAMENTO:nome=João|dia=terça|hora=9h|modalidade=musculacao]\nFechado João, terça 9h confirmado pra Musculação 💪 Te vejo lá', minsAgo: 155 },
    ],
    state: {
      estagio_atual: 'agendamento_confirmado',
      objetivo: 'massa',
      modalidade_recomendada: 'musculacao',
      disponibilidade: 'manha',
      aula_experimental_agendada: 1,
      data_agendamento: 'terça',
      hora_agendamento: '9h',
      modalidade_agendada: 'musculacao',
    },
  },
  {
    id: 'handoff',
    name: 'Carla (handoff por lesão)',
    estagio: 'handoff_humano',
    msgs: [
      { role: 'user', content: 'oi tive cirurgia no joelho ano passado', minsAgo: 60 },
      { role: 'assistant', content: '[ESTADO:estagio=handoff_humano|proxima_acao=encaminhar_equipe_tecnica]\n[MODULO_REQUERIDO:equipe_tecnica]\nOpa! Lesão precisa avaliação técnica direto. Vou te conectar com nossa equipe que tem experiência em adaptação. Te chamo aqui daqui a pouco com alguém da casa', minsAgo: 60 },
    ],
    state: { estagio_atual: 'handoff_humano', proxima_acao: 'encaminhar_equipe_tecnica' },
  },
  {
    id: 'perdeu',
    name: 'Ricardo (perdeu — sumiu há 36h)',
    estagio: 'qualificacao_objetivo',
    msgs: [
      { role: 'user', content: 'qual o valor?', minsAgo: 36 * 60 + 5 },
      { role: 'assistant', content: '[ESTADO:estagio=qualificacao_inicial|insistencias_valor=1]\nClaro, já chegamos lá. Mas antes me conta: tu tá treinando ou parado?', minsAgo: 36 * 60 + 5 },
      { role: 'user', content: 'parado', minsAgo: 36 * 60 },
      { role: 'assistant', content: '[ESTADO:estagio=qualificacao_objetivo|insistencias_valor=1]\nSaquei. E tu busca resultado físico ou qualidade de vida?', minsAgo: 36 * 60 },
    ],
    state: { estagio_atual: 'qualificacao_objetivo', insistencias_valor: 1 },
    lastContactMinsAgo: 36 * 60, // > 24h = perdeu
  },
  {
    id: 'tag_esquecida',
    name: 'Lucia (com tag esquecida)',
    estagio: 'apresentacao_planos',
    msgs: [
      { role: 'user', content: 'qual o valor?', minsAgo: 100 },
      { role: 'assistant', content: '[ESTADO:estagio=qualificacao_inicial|insistencias_valor=1]\nClaro, já te passo. Mas antes me conta: tu tá treinando ou parado?', minsAgo: 100 },
      { role: 'user', content: 'qual o valor?', minsAgo: 95 },
      { role: 'assistant', content: '[ESTADO:estagio=qualificacao_inicial|insistencias_valor=2]\nBem rapidinho antes: tu tá treinando ou parado?', minsAgo: 95 },
      { role: 'user', content: 'me passa os valores', minsAgo: 90 },
      // Sem tag (simula esquecimento)
      { role: 'assistant', content: 'Beleza, vou te passar: Flex R$ 199, No Limit R$ 149, Clube + R$ 109. Mas antes de fechar plano, vale conhecer a casa pessoalmente. Posso te encaixar terça ou quarta?', minsAgo: 90 },
    ],
    state: { estagio_atual: 'apresentacao_planos', insistencias_valor: 3 },
    eventsLog: [
      { type: db.V2_EVENT_TYPES.TURN_OK, minsAgo: 100 },
      { type: db.V2_EVENT_TYPES.TURN_OK, minsAgo: 95 },
      { type: db.V2_EVENT_TYPES.TAG_ESQUECIDA, minsAgo: 90 },
    ],
  },
];

function clean() {
  for (const sc of SCENARIOS) {
    const phone = FAKE_PREFIX + PHONE_IDS[sc.id];
    db.clearConversation(phone);
    db.deleteReview(phone);
  }
  // Apaga eventos de seed
  db.bulkUpsertStudents([]); // no-op, só pra exemplo
  console.log('[seed] cleaned');
}

function seed() {
  let total = 0;
  for (const sc of SCENARIOS) {
    const phone = FAKE_PREFIX + PHONE_IDS[sc.id];
    db.clearConversation(phone); // idempotente
    db.getOrCreateContact(phone);
    db.setContactName(phone, sc.name);
    db.getOrCreateLeadState(phone);

    for (const m of sc.msgs) {
      const ts = Date.now() - m.minsAgo * 60 * 1000;
      // Insert direto pra controlar timestamp
      const stmt = require('better-sqlite3')(process.env.DB_PATH || require('path').join(__dirname, '..', 'data', 'database.sqlite'));
      stmt.prepare('INSERT INTO messages (phone, role, content, was_audio, created_at) VALUES (?, ?, ?, 0, ?)')
        .run(phone, m.role, m.content, ts);
      stmt.close();
    }

    // Atualiza first_contact_at e last_contact_at retroativos (alinhados com msgs)
    const firstTs = Date.now() - sc.msgs[0].minsAgo * 60 * 1000;
    const lastTs = Date.now() - (sc.lastContactMinsAgo || sc.msgs[sc.msgs.length - 1].minsAgo) * 60 * 1000;
    require('better-sqlite3')(process.env.DB_PATH || require('path').join(__dirname, '..', 'data', 'database.sqlite'))
      .prepare('UPDATE contacts SET first_contact_at = ?, last_contact_at = ? WHERE phone = ?')
      .run(firstTs, lastTs, phone);

    // Aplica state
    if (sc.state) db.updateLeadState(phone, sc.state);

    // Aplica eventos sintéticos (pra alimentar métricas)
    if (sc.eventsLog) {
      for (const e of sc.eventsLog) {
        // Hack: logV2Event usa Date.now(), então inserimos diretamente
        require('better-sqlite3')(process.env.DB_PATH || require('path').join(__dirname, '..', 'data', 'database.sqlite'))
          .prepare('INSERT INTO v2_metrics_log (timestamp, event_type, phone, value, meta) VALUES (?, ?, ?, NULL, NULL)')
          .run(Date.now() - e.minsAgo * 60 * 1000, e.type, phone);
      }
    }

    total++;
    console.log(`✓ [${sc.id}] ${sc.name} (phone=${phone}, ${sc.msgs.length} msgs)`);
  }
  console.log(`\n[seed] ${total} conversas v2 criadas. Acesse /admin → Monitor v2.`);
}

if (process.argv.includes('--clean')) {
  clean();
  process.exit(0);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('[seed] ANTHROPIC_API_KEY não definida — ok pra seed, mas v2 não vai responder.');
}

seed();
