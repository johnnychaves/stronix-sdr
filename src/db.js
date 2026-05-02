const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Path do banco: usa DB_PATH do env (Railway com volume) ou ./data/database.sqlite local
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'database.sqlite');

// Cria diretório se não existir
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  console.log(`[db] criado diretório ${dbDir}`);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');     // melhor performance + concorrência
db.pragma('foreign_keys = ON');

console.log(`[db] conectado em ${DB_PATH}`);

// ─────────────────────────────────────────────────────────────────────
// SCHEMA
// ─────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    phone TEXT PRIMARY KEY,
    name TEXT,
    audio_permission INTEGER DEFAULT 0,
    awaiting_audio_confirm INTEGER DEFAULT 0,
    asked_for_audio INTEGER DEFAULT 0,
    first_contact_at INTEGER NOT NULL,
    last_contact_at INTEGER NOT NULL,
    metadata TEXT
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    was_audio INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (phone) REFERENCES contacts(phone) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone);
  CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);

  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    name TEXT,
    modality TEXT,
    scheduled_day TEXT,
    scheduled_turn TEXT,
    scheduled_hour TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'cancelled', 'no_show')),
    created_at INTEGER NOT NULL,
    notes TEXT,
    FOREIGN KEY (phone) REFERENCES contacts(phone) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_appointments_phone ON appointments(phone);
  CREATE INDEX IF NOT EXISTS idx_appointments_created_at ON appointments(created_at DESC);

  CREATE TABLE IF NOT EXISTS conversation_reviews (
    phone TEXT PRIMARY KEY,
    rating TEXT NOT NULL CHECK(rating IN ('good', 'bad')),
    comment TEXT,
    reviewed_at INTEGER NOT NULL,
    FOREIGN KEY (phone) REFERENCES contacts(phone) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_reviews_rating ON conversation_reviews(rating);
  CREATE INDEX IF NOT EXISTS idx_reviews_reviewed_at ON conversation_reviews(reviewed_at DESC);

  CREATE TABLE IF NOT EXISTS students (
    phone TEXT PRIMARY KEY,
    name TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','consultora')),
    phone TEXT,
    active INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at DESC);

  -- Knowledge base estruturado da academia (planos, horários, modalidades, etc).
  -- Editável via painel sem precisar mexer no system prompt. Injetado no
  -- contexto da IA dinamicamente pra cada conversa.
  CREATE TABLE IF NOT EXISTS academia_info (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    label TEXT,
    description TEXT,
    category TEXT,
    display_order INTEGER DEFAULT 0,
    updated_at INTEGER NOT NULL,
    updated_by INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_academia_info_category ON academia_info(category, display_order);

  -- ─────────────────────────────────────────────────────────────────────
  -- AGENT V2 — Máquina de estado por lead (refatoração modular do Johnny)
  -- ─────────────────────────────────────────────────────────────────────

  -- Ficha do lead com estado da conversa estruturado.
  -- FK pra contacts.phone (mantém contacts como cadastro, lead_state como dinâmica).
  CREATE TABLE IF NOT EXISTS lead_state (
    phone TEXT PRIMARY KEY,
    estagio_atual TEXT NOT NULL DEFAULT 'qualificacao_inicial',
    proxima_acao TEXT,
    insistencias_valor INTEGER NOT NULL DEFAULT 0,
    objetivo TEXT,
    modalidade_recomendada TEXT,
    disponibilidade TEXT,
    objecao_ativa TEXT,
    objecoes_levantadas TEXT,                  -- JSON array
    tentativas_objecao_atual INTEGER NOT NULL DEFAULT 0,
    aula_experimental_agendada INTEGER NOT NULL DEFAULT 0,
    data_agendamento TEXT,
    hora_agendamento TEXT,
    modalidade_agendada TEXT,
    primeira_mensagem_em INTEGER,
    ultima_mensagem_em INTEGER,
    total_mensagens_lead INTEGER NOT NULL DEFAULT 0,
    total_mensagens_johnny INTEGER NOT NULL DEFAULT 0,
    resumo_dinamico TEXT,
    tags_sistema_ativas TEXT,                  -- JSON array
    is_aluno_existente INTEGER NOT NULL DEFAULT 0,
    encerrada_em INTEGER,
    motivo_encerramento TEXT,
    modulo_pendente TEXT,                      -- fallback: módulo pedido por Johnny
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (phone) REFERENCES contacts(phone) ON DELETE CASCADE
  );

  -- Repositório dos 28 módulos do prompt (carregados sob demanda).
  -- Editáveis via aba 'Módulos' no admin sem redeploy.
  CREATE TABLE IF NOT EXISTS prompt_modules (
    name TEXT PRIMARY KEY,
    title TEXT,
    content TEXT NOT NULL,
    category TEXT,                             -- 'conhecimento'|'objecoes'|'situacionais'|'sistema'
    active INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL,
    updated_by INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_prompt_modules_category ON prompt_modules(category, name);
`);

// Seed inicial do academia_info — só insere se ainda não existir.
// Chaves cobrem o que aparece com mais frequência em conversas de lead.
const ACADEMIA_INFO_SEED = [
  // Planos
  { key: 'plano_mensal_valor',      label: 'Plano Mensal — valor',      category: 'planos',      order: 1, description: 'Ex: R$ 149,90/mês' },
  { key: 'plano_trimestral_valor',  label: 'Plano Trimestral — valor',  category: 'planos',      order: 2, description: 'Ex: R$ 119,90/mês' },
  { key: 'plano_anual_valor',       label: 'Plano Anual — valor',       category: 'planos',      order: 3, description: 'Ex: R$ 99,90/mês' },
  { key: 'plano_observacoes',       label: 'Observações sobre planos',  category: 'planos',      order: 4, description: 'Cancelamento, fidelidade, etc.' },
  // Modalidades & estrutura
  { key: 'modalidades',             label: 'Modalidades oferecidas',    category: 'estrutura',   order: 1, description: 'Ex: Musculação, Cross Functional, Pilates, Spinning' },
  { key: 'professores_destaque',    label: 'Professores em destaque',   category: 'estrutura',   order: 2, description: 'Nomes que vale mencionar quando lead pergunta' },
  { key: 'equipamentos_destaque',   label: 'Equipamentos diferenciais', category: 'estrutura',   order: 3, description: 'Ex: Smith customizado, plataformas, halteres até X kg' },
  // Horários
  { key: 'horario_seg_sex',         label: 'Horário seg-sex',           category: 'horarios',    order: 1, description: 'Ex: 06:00-22:00' },
  { key: 'horario_sab',             label: 'Horário sábado',            category: 'horarios',    order: 2, description: 'Ex: 08:00-14:00' },
  { key: 'horario_dom',             label: 'Horário domingo',           category: 'horarios',    order: 3, description: 'Ex: Fechado / 08:00-12:00' },
  // Localização & contato
  { key: 'endereco',                label: 'Endereço completo',         category: 'contato',     order: 1, description: 'Rua, número, bairro' },
  { key: 'instagram',               label: 'Instagram',                 category: 'contato',     order: 2, description: 'Ex: @stronixacademia' },
  // Promo do mês (vazio = sem promo ativa)
  { key: 'promo_atual_titulo',      label: 'Promo atual — título',      category: 'promo',       order: 1, description: 'Ex: "Plano anual com 30% off". Deixa vazio se não há promo.' },
  { key: 'promo_atual_descricao',   label: 'Promo atual — detalhes',    category: 'promo',       order: 2, description: 'Condições, valor promocional, etc.' },
  { key: 'promo_atual_validade',    label: 'Promo atual — validade',    category: 'promo',       order: 3, description: 'Ex: "Até 15/12" ou "Enquanto durarem as vagas"' },
  // Diferenciais
  { key: 'diferenciais',            label: 'Diferenciais da STRONIX',   category: 'institucional', order: 1, description: 'Por que escolher aqui? Use bullets ou frases curtas.' },
];
const seedStmt = db.prepare(`
  INSERT OR IGNORE INTO academia_info (key, value, label, description, category, display_order, updated_at)
  VALUES (?, '', ?, ?, ?, ?, ?)
`);
const seedNow = Date.now();
for (const r of ACADEMIA_INFO_SEED) {
  seedStmt.run(r.key, r.label, r.description, r.category, r.order, seedNow);
}

// Migração: adiciona scheduled_hour em bancos que já existiam antes dessa coluna
const apptCols = db.prepare('PRAGMA table_info(appointments)').all();
if (!apptCols.find(c => c.name === 'scheduled_hour')) {
  db.exec('ALTER TABLE appointments ADD COLUMN scheduled_hour TEXT');
  console.log('[db] migração: coluna scheduled_hour adicionada em appointments');
}

// Migração: simplifica rating de 3 valores ('good','bad','flagged') pra 2 ('good','bad')
// Converte qualquer 'flagged' existente em 'bad'
const flaggedCount = db.prepare("SELECT COUNT(*) as c FROM conversation_reviews WHERE rating = 'flagged'").get();
if (flaggedCount && flaggedCount.c > 0) {
  db.exec("UPDATE conversation_reviews SET rating = 'bad' WHERE rating = 'flagged'");
  console.log(`[db] migração: ${flaggedCount.c} review(s) com rating='flagged' convertidas pra 'bad'`);
}

// Migração: assignment + handoff IA↔humano por contato
const contactCols = db.prepare('PRAGMA table_info(contacts)').all();
if (!contactCols.find(c => c.name === 'assigned_user_id')) {
  db.exec('ALTER TABLE contacts ADD COLUMN assigned_user_id INTEGER');
  console.log('[db] migração: coluna assigned_user_id adicionada em contacts');
}
if (!contactCols.find(c => c.name === 'human_assumed_at')) {
  db.exec('ALTER TABLE contacts ADD COLUMN human_assumed_at INTEGER');
  console.log('[db] migração: coluna human_assumed_at adicionada em contacts');
}

// Migração: rastreia quem enviou cada mensagem (NULL = IA, ou user_id da consultora)
const msgCols = db.prepare('PRAGMA table_info(messages)').all();
if (!msgCols.find(c => c.name === 'sent_by_user_id')) {
  db.exec('ALTER TABLE messages ADD COLUMN sent_by_user_id INTEGER');
  console.log('[db] migração: coluna sent_by_user_id adicionada em messages');
}
// Migração: caminho do arquivo de mídia salvo localmente (relativo a MEDIA_DIR)
// Usado pra renderizar player de áudio no painel
if (!msgCols.find(c => c.name === 'media_path')) {
  db.exec('ALTER TABLE messages ADD COLUMN media_path TEXT');
  console.log('[db] migração: coluna media_path adicionada em messages');
}
// Migração: ID da mensagem na Meta (wamid.XXX) — pra correlacionar com webhooks de status
if (!msgCols.find(c => c.name === 'wamid')) {
  db.exec('ALTER TABLE messages ADD COLUMN wamid TEXT');
  console.log('[db] migração: coluna wamid adicionada em messages');
}
// Migração: status da entrega (sent / delivered / read / failed) — atualizado via webhook
if (!msgCols.find(c => c.name === 'delivery_status')) {
  db.exec('ALTER TABLE messages ADD COLUMN delivery_status TEXT');
  db.exec('ALTER TABLE messages ADD COLUMN delivered_at INTEGER');
  db.exec('ALTER TABLE messages ADD COLUMN read_at INTEGER');
  console.log('[db] migração: colunas delivery_status/delivered_at/read_at adicionadas em messages');
}

// Migração Fase 3 (PR #36): número de msgs já cobertas pelo resumo dinâmico.
// Permite identificar quais msgs ainda NÃO foram resumidas (e devem ir cruas no contexto).
const lsCols = db.prepare('PRAGMA table_info(lead_state)').all();
if (!lsCols.find(c => c.name === 'resumo_dinamico_n_msgs')) {
  db.exec('ALTER TABLE lead_state ADD COLUMN resumo_dinamico_n_msgs INTEGER NOT NULL DEFAULT 0');
  console.log('[db] migração: coluna resumo_dinamico_n_msgs adicionada em lead_state');
}

// Migração PR #37: estende conversation_reviews pra aceitar 'aceitavel' (3-níveis).
// SQLite não permite ALTER CHECK direto — precisa table-rebuild se schema antigo.
// Detecta via sqlite_master.sql se o CHECK já tem 'aceitavel' antes de mexer.
const reviewsTbl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='conversation_reviews'").get();
if (reviewsTbl && !reviewsTbl.sql.includes("'aceitavel'")) {
  db.exec(`
    ALTER TABLE conversation_reviews RENAME TO conversation_reviews_old;
    CREATE TABLE conversation_reviews (
      phone TEXT PRIMARY KEY,
      rating TEXT NOT NULL CHECK(rating IN ('good', 'aceitavel', 'bad')),
      comment TEXT,
      reviewed_at INTEGER NOT NULL,
      FOREIGN KEY (phone) REFERENCES contacts(phone) ON DELETE CASCADE
    );
    INSERT INTO conversation_reviews (phone, rating, comment, reviewed_at)
      SELECT phone, rating, comment, reviewed_at FROM conversation_reviews_old;
    DROP TABLE conversation_reviews_old;
    CREATE INDEX IF NOT EXISTS idx_reviews_rating ON conversation_reviews(rating);
    CREATE INDEX IF NOT EXISTS idx_reviews_reviewed_at ON conversation_reviews(reviewed_at DESC);
  `);
  console.log("[db] migração: conversation_reviews estendida pra aceitar 'aceitavel'");
}

// Migração PR #37: tabela append-only de eventos pra métricas e alertas.
// event_type cobre: tag_esquecida, router_empty, preco_inventado, valor_antecipado,
// crash, version_change, force_resumo. value/meta livres pra extensão.
db.exec(`
  CREATE TABLE IF NOT EXISTS v2_metrics_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    phone TEXT,
    value REAL,
    meta TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_v2_log_ts ON v2_metrics_log(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_v2_log_event_ts ON v2_metrics_log(event_type, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_v2_log_phone ON v2_metrics_log(phone);

  CREATE TABLE IF NOT EXISTS v2_runtime_flags (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    updated_by INTEGER
  );
`);

// ─────────────────────────────────────────────────────────────────────
// PREPARED STATEMENTS (otimizadas, reusadas)
// ─────────────────────────────────────────────────────────────────────

const stmts = {
  getContact: db.prepare('SELECT * FROM contacts WHERE phone = ?'),

  createContact: db.prepare(`
    INSERT INTO contacts (phone, first_contact_at, last_contact_at)
    VALUES (?, ?, ?)
  `),

  updateLastContact: db.prepare(`
    UPDATE contacts SET last_contact_at = ? WHERE phone = ?
  `),

  updateAudioFlags: db.prepare(`
    UPDATE contacts
    SET audio_permission = ?, awaiting_audio_confirm = ?, asked_for_audio = ?
    WHERE phone = ?
  `),

  updateName: db.prepare('UPDATE contacts SET name = ? WHERE phone = ?'),

  insertMessage: db.prepare(`
    INSERT INTO messages (phone, role, content, was_audio, created_at)
    VALUES (?, ?, ?, ?, ?)
  `),

  getRecentMessages: db.prepare(`
    SELECT role, content FROM messages
    WHERE phone = ?
    ORDER BY id DESC
    LIMIT ?
  `),

  countMessages: db.prepare('SELECT COUNT(*) as count FROM messages WHERE phone = ?'),

  getAllContacts: db.prepare(`
    SELECT c.*, COUNT(m.id) as message_count
    FROM contacts c
    LEFT JOIN messages m ON m.phone = c.phone
    GROUP BY c.phone
    ORDER BY c.last_contact_at DESC
  `),

  getMessagesForContact: db.prepare(`
    SELECT role, content FROM messages
    WHERE phone = ?
    ORDER BY id ASC
  `),

  getLastMessage: db.prepare(`
    SELECT role, content FROM messages
    WHERE phone = ?
    ORDER BY id DESC
    LIMIT 1
  `),

  deleteMessages: db.prepare('DELETE FROM messages WHERE phone = ?'),
  deleteContact: db.prepare('DELETE FROM contacts WHERE phone = ?'),

  // Appointments
  createAppointment: db.prepare(`
    INSERT INTO appointments (phone, name, modality, scheduled_day, scheduled_turn, scheduled_hour, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  getAppointments: db.prepare(`
    SELECT a.*, c.name as contact_name
    FROM appointments a
    LEFT JOIN contacts c ON c.phone = a.phone
    ORDER BY a.created_at DESC
    LIMIT ?
  `),
  getAppointmentsByPhone: db.prepare(`
    SELECT * FROM appointments WHERE phone = ? ORDER BY created_at DESC
  `),
  updateAppointmentStatus: db.prepare(`
    UPDATE appointments SET status = ? WHERE id = ?
  `),

  // Reviews
  upsertReview: db.prepare(`
    INSERT INTO conversation_reviews (phone, rating, comment, reviewed_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(phone) DO UPDATE SET
      rating = excluded.rating,
      comment = excluded.comment,
      reviewed_at = excluded.reviewed_at
  `),
  getReview: db.prepare('SELECT * FROM conversation_reviews WHERE phone = ?'),
  getAllReviews: db.prepare('SELECT * FROM conversation_reviews ORDER BY reviewed_at DESC'),
  deleteReview: db.prepare('DELETE FROM conversation_reviews WHERE phone = ?'),

  // Students
  upsertStudent: db.prepare(`
    INSERT INTO students (phone, name, notes, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(phone) DO UPDATE SET
      name = excluded.name,
      notes = excluded.notes
  `),
  getStudent: db.prepare('SELECT * FROM students WHERE phone = ?'),
  getAllStudents: db.prepare('SELECT * FROM students ORDER BY created_at DESC'),
  deleteStudent: db.prepare('DELETE FROM students WHERE phone = ?'),

  // Users
  insertUser: db.prepare(`
    INSERT INTO users (username, password_hash, display_name, role, phone, active, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `),
  getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
  getAllUsers: db.prepare('SELECT id, username, display_name, role, phone, active, created_at FROM users ORDER BY created_at DESC'),
  setUserActive: db.prepare('UPDATE users SET active = ? WHERE id = ?'),
  setUserPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
  setUserRole: db.prepare('UPDATE users SET role = ? WHERE id = ?'),
  setUserPhone: db.prepare('UPDATE users SET phone = ? WHERE id = ?'),
  setUserDisplayName: db.prepare('UPDATE users SET display_name = ? WHERE id = ?'),
  deleteUserStmt: db.prepare('DELETE FROM users WHERE id = ?'),
  countUsers: db.prepare('SELECT COUNT(*) as c FROM users'),
  countAdmins: db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin' AND active = 1"),
  getUsersByRole: db.prepare('SELECT * FROM users WHERE role = ? AND active = 1'),

  // Sessions
  insertSession: db.prepare(`
    INSERT INTO sessions (token, user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `),
  getSessionByToken: db.prepare(`
    SELECT s.token, s.user_id, s.created_at, s.expires_at,
           u.id as u_id, u.username, u.display_name, u.role, u.phone, u.active
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  deleteSessionsForUser: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  cleanExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),

  // Conversation assignment
  assumeConversationStmt: db.prepare(`
    UPDATE contacts SET assigned_user_id = ?, human_assumed_at = ?
    WHERE phone = ? AND assigned_user_id IS NULL
  `),
  forceAssumeConversation: db.prepare(`
    UPDATE contacts SET assigned_user_id = ?, human_assumed_at = ?
    WHERE phone = ?
  `),
  releaseConversationStmt: db.prepare(`
    UPDATE contacts SET assigned_user_id = NULL, human_assumed_at = NULL
    WHERE phone = ?
  `),
  getContactWithAssignment: db.prepare('SELECT * FROM contacts WHERE phone = ?'),

  // Messages with sender tracking
  insertMessageWithSender: db.prepare(`
    INSERT INTO messages (phone, role, content, was_audio, sent_by_user_id, created_at, media_path, wamid)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getMessagesWithSender: db.prepare(`
    SELECT id, role, content, was_audio, sent_by_user_id, created_at,
           media_path, wamid, delivery_status, delivered_at, read_at
    FROM messages WHERE phone = ? ORDER BY id ASC
  `),

  // Status updates (delivery receipts)
  updateMessageStatus: db.prepare(`
    UPDATE messages
    SET delivery_status = COALESCE(?, delivery_status),
        delivered_at    = COALESCE(?, delivered_at),
        read_at         = COALESCE(?, read_at)
    WHERE wamid = ?
  `),
  getMessageByWamid: db.prepare('SELECT * FROM messages WHERE wamid = ?'),
};

// ─────────────────────────────────────────────────────────────────────
// API PÚBLICA
// ─────────────────────────────────────────────────────────────────────

function getContact(phone) {
  return stmts.getContact.get(phone) || null;
}

// Canonicaliza um phone tentando variações BR antes de criar duplicata.
// Cenário: user cria contato '5551997564760' (com 9). Quando o lead responde,
// WhatsApp manda como '555197564760' (sem 9 — JID canônico). Sem este lookup,
// criaríamos 2 contatos pra mesma pessoa.
//
// Estratégia: tenta phone exato; se não existe, tenta variação ±9; se uma
// dessas existe, retorna a forma já cadastrada.
function canonicalizeContactPhone(phone) {
  if (!phone) return phone;
  const p = String(phone);
  if (stmts.getContact.get(p)) return p;
  if (p.startsWith('55') && p.length === 13 && p[4] === '9') {
    const without9 = p.slice(0, 4) + p.slice(5);
    if (stmts.getContact.get(without9)) return without9;
  } else if (p.startsWith('55') && p.length === 12) {
    const with9 = p.slice(0, 4) + '9' + p.slice(4);
    if (stmts.getContact.get(with9)) return with9;
  }
  return p; // nenhuma variação existe — caller decide criar
}

function getOrCreateContact(phone) {
  // Sempre passa pelo canonicalize antes — se variação ±9 já existe, usa ela
  phone = canonicalizeContactPhone(phone);
  let contact = getContact(phone);
  if (!contact) {
    const now = Date.now();
    stmts.createContact.run(phone, now, now);
    contact = getContact(phone);
    console.log(`[db] novo contato criado: ${phone}`);
  }
  return contact;
}

function updateLastContact(phone) {
  phone = canonicalizeContactPhone(phone);
  stmts.updateLastContact.run(Date.now(), phone);
}

// Atualiza nome de um contato (NULL pra limpar)
function setContactName(phone, name) {
  stmts.updateName.run(name && name.trim() ? name.trim() : null, phone);
}

function updateAudioFlags(phone, { audioPermission, awaitingAudioConfirm, askedForAudio }) {
  stmts.updateAudioFlags.run(
    audioPermission ? 1 : 0,
    awaitingAudioConfirm ? 1 : 0,
    askedForAudio ? 1 : 0,
    phone
  );
}

function addMessage(phone, role, content, wasAudio = false, mediaPath = null) {
  // Canonicaliza phone pra unificar com contato existente (variação ±9 BR)
  phone = canonicalizeContactPhone(phone);
  if (mediaPath) {
    db.prepare('INSERT INTO messages (phone, role, content, was_audio, media_path, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(phone, role, content, wasAudio ? 1 : 0, mediaPath, Date.now());
  } else {
    stmts.insertMessage.run(phone, role, content, wasAudio ? 1 : 0, Date.now());
  }
  try { require('./events').emitConversationChanged(phone); } catch {}
}

// Retorna histórico no formato esperado pelo Claude: [{role, content}, ...]
// Limit é em número de mensagens (não de pares). Default alto pra não cortar contexto cedo.
function getHistory(phone, limit = 100) {
  const rows = stmts.getRecentMessages.all(phone, limit);
  // Vem em ordem DESC (mais recente primeiro), inverte pra ordem cronológica
  return rows.reverse();
}

// Retorna TODAS as mensagens da conversa em ordem cronológica.
// Usado pelo resumo dinâmico (Fase 3) pra alimentar Haiku 4.5.
function getAllMessages(phone) {
  return stmts.getMessagesForContact.all(phone);
}

function getMessageCount(phone) {
  const row = stmts.countMessages.get(phone);
  return row ? row.count : 0;
}

// Retorna número de dias desde o último contato. null se for primeiro contato.
function getDaysSinceLastContact(phone) {
  const contact = getContact(phone);
  if (!contact) return null;

  const messageCount = getMessageCount(phone);
  if (messageCount === 0) return null; // primeiro contato real

  const diffMs = Date.now() - contact.last_contact_at;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// Lista todos os contatos com resumo (pra painel admin)
function getAllConversations() {
  const contacts = stmts.getAllContacts.all();
  return contacts.map(c => {
    const history = stmts.getMessagesWithSender.all(c.phone).map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      wasAudio: !!m.was_audio,
      sentByUserId: m.sent_by_user_id || null,
      createdAt: m.created_at,
      mediaPath: m.media_path || null,
      wamid: m.wamid || null,
      deliveryStatus: m.delivery_status || null,
      deliveredAt: m.delivered_at || null,
      readAt: m.read_at || null,
    }));
    const lastMessage = history.length > 0 ? history[history.length - 1] : null;
    const review = stmts.getReview.get(c.phone) || null;
    const assignedUser = c.assigned_user_id ? stmts.getUserById.get(c.assigned_user_id) : null;
    return {
      from: c.phone,
      fromDisplay: c.phone.slice(0, 2) + '...' + c.phone.slice(-4),
      name: c.name,
      messageCount: history.length,
      audioPermission: !!c.audio_permission,
      firstContactAt: c.first_contact_at,
      lastContactAt: c.last_contact_at,
      assignedUserId: c.assigned_user_id || null,
      assignedUserName: assignedUser ? assignedUser.display_name : null,
      humanAssumedAt: c.human_assumed_at || null,
      lastMessage,
      history,
      review: review ? {
        rating: review.rating,
        comment: review.comment,
        reviewedAt: review.reviewed_at,
      } : null,
    };
  });
}

function clearConversation(phone) {
  stmts.deleteMessages.run(phone);
  stmts.deleteContact.run(phone);
  console.log(`[db] conversa limpa: ${phone}`);
}

// ─────────────────────────────────────────────────────────────────────
// APPOINTMENTS
// ─────────────────────────────────────────────────────────────────────

function createAppointment(phone, { name, modality, scheduledDay, scheduledTurn, scheduledHour }) {
  const result = stmts.createAppointment.run(
    phone,
    name || null,
    modality || null,
    scheduledDay || null,
    scheduledTurn || null,
    scheduledHour || null,
    Date.now()
  );
  console.log(`[db] agendamento criado id=${result.lastInsertRowid} para ${phone}`);
  return result.lastInsertRowid;
}

function getAppointments(limit = 50) {
  return stmts.getAppointments.all(limit);
}

function getAppointmentsByPhone(phone) {
  return stmts.getAppointmentsByPhone.all(phone);
}

function updateAppointmentStatus(id, status) {
  stmts.updateAppointmentStatus.run(status, id);
}

// ─────────────────────────────────────────────────────────────────────
// REVIEWS
// ─────────────────────────────────────────────────────────────────────

function upsertReview(phone, rating, comment) {
  stmts.upsertReview.run(phone, rating, comment || null, Date.now());
}

function getReview(phone) {
  return stmts.getReview.get(phone) || null;
}

function getAllReviews() {
  return stmts.getAllReviews.all();
}

function deleteReview(phone) {
  stmts.deleteReview.run(phone);
}

// ─────────────────────────────────────────────────────────────────────
// STUDENTS (alunos atuais — desviam IA pra atendimento humano)
// ─────────────────────────────────────────────────────────────────────

function upsertStudent(phone, name, notes) {
  stmts.upsertStudent.run(phone, name || null, notes || null, Date.now());
}

function getStudent(phone) {
  return stmts.getStudent.get(phone) || null;
}

function isStudent(phone) {
  return !!stmts.getStudent.get(phone);
}

function getAllStudents() {
  return stmts.getAllStudents.all();
}

function deleteStudent(phone) {
  stmts.deleteStudent.run(phone);
}

// ─────────────────────────────────────────────────────────────────────
// USERS + AUTH (scrypt do crypto built-in, sem dep nova)
// ─────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'));
}

function createUser({ username, password, displayName, role, phone }) {
  if (!['admin', 'consultora'].includes(role)) throw new Error('role inválida');
  if (!username || !password || !displayName) throw new Error('username, password e displayName obrigatórios');
  const result = stmts.insertUser.run(
    username.trim().toLowerCase(),
    hashPassword(password),
    displayName.trim(),
    role,
    phone ? String(phone).replace(/\D/g, '') || null : null,
    Date.now()
  );
  console.log(`[db] usuário criado id=${result.lastInsertRowid} username=${username} role=${role}`);
  return result.lastInsertRowid;
}

function authenticateUser(username, password) {
  const u = stmts.getUserByUsername.get(String(username || '').trim().toLowerCase());
  if (!u || !u.active) return null;
  if (!verifyPassword(password, u.password_hash)) return null;
  return u;
}

function getUserById(id) {
  return stmts.getUserById.get(id) || null;
}

function getAllUsers() {
  return stmts.getAllUsers.all();
}

function setUserActive(id, active) {
  stmts.setUserActive.run(active ? 1 : 0, id);
}

function setUserPassword(id, password) {
  stmts.setUserPassword.run(hashPassword(password), id);
  // Invalida todas as sessões do user — força re-login após reset
  stmts.deleteSessionsForUser.run(id);
}

function setUserRole(id, role) {
  if (!['admin', 'consultora'].includes(role)) throw new Error('role inválida');
  stmts.setUserRole.run(role, id);
}

function setUserPhone(id, phone) {
  stmts.setUserPhone.run(phone ? String(phone).replace(/\D/g, '') || null : null, id);
}

function setUserDisplayName(id, displayName) {
  stmts.setUserDisplayName.run(displayName.trim(), id);
}

function deleteUser(id) {
  stmts.deleteSessionsForUser.run(id);
  stmts.deleteUserStmt.run(id);
}

function countUsers() {
  return stmts.countUsers.get().c;
}

function countAdmins() {
  return stmts.countAdmins.get().c;
}

function getActiveConsultors() {
  return stmts.getUsersByRole.all('consultora');
}

function getActiveAdmins() {
  return stmts.getUsersByRole.all('admin');
}

// ─────────────────────────────────────────────────────────────────────
// SESSIONS
// ─────────────────────────────────────────────────────────────────────

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

function createSession(userId, ttlMs = SESSION_TTL_MS) {
  const token = crypto.randomUUID();
  const now = Date.now();
  stmts.insertSession.run(token, userId, now, now + ttlMs);
  return { token, expires: now + ttlMs };
}

function getSessionUser(token) {
  if (!token) return null;
  const row = stmts.getSessionByToken.get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    stmts.deleteSession.run(token);
    return null;
  }
  if (!row.active) return null;
  return {
    id: row.u_id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    phone: row.phone,
  };
}

function deleteSession(token) {
  stmts.deleteSession.run(token);
}

function cleanExpiredSessions() {
  const result = stmts.cleanExpiredSessions.run(Date.now());
  if (result.changes > 0) console.log(`[db] removidas ${result.changes} sessões expiradas`);
}

// ─────────────────────────────────────────────────────────────────────
// CONVERSATION ASSIGNMENT (handoff IA ↔ humano)
// ─────────────────────────────────────────────────────────────────────

// Tenta assumir; retorna true se conseguiu, false se outro user já assumiu
// (pool aberto: primeiro a clicar pega).
function assumeConversation(phone, userId) {
  phone = canonicalizeContactPhone(phone);
  getOrCreateContact(phone);
  const result = stmts.assumeConversationStmt.run(userId, Date.now(), phone);
  if (result.changes > 0) {
    try { require('./events').emitConversationChanged(phone); } catch {}
  }
  return result.changes > 0;
}

function releaseConversation(phone) {
  phone = canonicalizeContactPhone(phone);
  stmts.releaseConversationStmt.run(phone);
  try { require('./events').emitConversationChanged(phone); } catch {}
}

function getContactAssignment(phone) {
  const c = stmts.getContactWithAssignment.get(phone);
  if (!c) return null;
  return {
    assignedUserId: c.assigned_user_id || null,
    humanAssumedAt: c.human_assumed_at || null,
  };
}

// Mensagem com sender (NULL = IA, ou user_id da consultora)
// Retorna o lastInsertRowid pra quem precisar atualizar wamid/status depois.
function addMessageWithSender(phone, role, content, wasAudio, sentByUserId, mediaPath = null, wamid = null) {
  phone = canonicalizeContactPhone(phone);
  const r = stmts.insertMessageWithSender.run(
    phone, role, content, wasAudio ? 1 : 0,
    sentByUserId || null, Date.now(),
    mediaPath || null, wamid || null
  );
  try { require('./events').emitConversationChanged(phone); } catch {}
  return r.lastInsertRowid;
}

// Atualiza media_path da mensagem assistant mais recente desse phone.
// Usado depois de gerar áudio via TTS — agent.reply já salvou o texto, mas
// não tinha o buffer ainda. Esta função adiciona o ponteiro pro arquivo.
function setLastAssistantMessageMediaPath(phone, mediaPath) {
  phone = canonicalizeContactPhone(phone);
  db.prepare(`
    UPDATE messages SET media_path = ?
    WHERE id = (
      SELECT id FROM messages
      WHERE phone = ? AND role = 'assistant'
      ORDER BY id DESC LIMIT 1
    )
  `).run(mediaPath, phone);
  try { require('./events').emitConversationChanged(phone); } catch {}
}

// Atualiza status de entrega via webhook (delivered/read)
function updateMessageDeliveryStatus(wamid, status, timestamp) {
  if (!wamid) return;
  const ts = timestamp ? timestamp * 1000 : Date.now(); // Meta envia em segundos
  const deliveredAt = (status === 'delivered' || status === 'read') ? ts : null;
  const readAt      = (status === 'read') ? ts : null;
  stmts.updateMessageStatus.run(status, deliveredAt, readAt, wamid);
  // Emite evento — frontend atualiza checkmarks ✓✓ na hora
  try {
    const row = stmts.getMessageByWamid.get(wamid);
    if (row?.phone) require('./events').emitConversationChanged(row.phone);
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────
// METRICS (agregações pra aba Métricas — admin only)
// ─────────────────────────────────────────────────────────────────────

function getMetrics() {
  const now = Date.now();
  const cutoff30d = now - (30 * 24 * 60 * 60 * 1000);
  const last24h   = now - (24 * 60 * 60 * 1000);

  const totalConversations30d = db.prepare('SELECT COUNT(*) as c FROM contacts WHERE first_contact_at >= ?').get(cutoff30d).c;
  const handoffCount = db.prepare('SELECT COUNT(*) as c FROM contacts WHERE first_contact_at >= ? AND human_assumed_at IS NOT NULL').get(cutoff30d).c;
  const activeHumanHandoff = db.prepare('SELECT COUNT(*) as c FROM contacts WHERE human_assumed_at IS NOT NULL').get().c;

  const unassignedActive = db.prepare(`
    SELECT COUNT(DISTINCT c.phone) as c
    FROM contacts c
    JOIN messages m ON m.phone = c.phone
    WHERE c.assigned_user_id IS NULL
      AND m.created_at >= ?
      AND m.role = 'user'
  `).get(last24h).c;

  const firstReplyRow = db.prepare(`
    SELECT
      AVG((SELECT MIN(m2.created_at) FROM messages m2
            WHERE m2.phone = c.phone
              AND m2.role = 'assistant'
              AND m2.sent_by_user_id IS NULL
              AND m2.created_at >= c.first_contact_at) - c.first_contact_at) AS avg_ms,
      COUNT(*) AS samples
    FROM contacts c
    WHERE c.first_contact_at >= ?
      AND EXISTS (SELECT 1 FROM messages WHERE phone = c.phone AND role = 'assistant' AND sent_by_user_id IS NULL)
  `).get(cutoff30d);

  const byConsultor = db.prepare(`
    SELECT u.id, u.display_name, COUNT(DISTINCT m.phone) as count
    FROM messages m
    JOIN users u ON u.id = m.sent_by_user_id
    WHERE m.created_at >= ? AND m.sent_by_user_id IS NOT NULL
    GROUP BY u.id, u.display_name
    ORDER BY count DESC
  `).all(cutoff30d);

  const studentsCount = stmts.getAllStudents.all().length;

  return {
    totalConversations30d,
    handoffCount,
    handoffPct: totalConversations30d ? handoffCount / totalConversations30d : 0,
    activeHumanHandoff,
    unassignedActive,
    avgFirstReplySec: firstReplyRow && firstReplyRow.avg_ms ? firstReplyRow.avg_ms / 1000 : null,
    firstReplySamples: firstReplyRow ? firstReplyRow.samples : 0,
    byConsultor,
    studentsCount,
  };
}

// Insere múltiplos alunos numa única transação. Retorna { inserted, updated, skipped }.
// items: array de { phone, name?, notes? }. Phones com menos de 10 dígitos são skipped.
function bulkUpsertStudents(items) {
  let inserted = 0, updated = 0, skipped = 0;
  const tx = db.transaction((items) => {
    const now = Date.now();
    for (const item of items) {
      const phone = String(item.phone || '').replace(/\D/g, '');
      if (phone.length < 10) { skipped++; continue; }
      const existed = !!stmts.getStudent.get(phone);
      stmts.upsertStudent.run(phone, item.name || null, item.notes || null, now);
      if (existed) updated++; else inserted++;
    }
  });
  tx(items);
  return { inserted, updated, skipped };
}

// ─────────────────────────────────────────────────────────────────────
// AGENT V2 — lead_state (máquina de estado por lead)
// ─────────────────────────────────────────────────────────────────────

const LEAD_STATE_FIELDS = [
  'estagio_atual', 'proxima_acao', 'insistencias_valor', 'objetivo',
  'modalidade_recomendada', 'disponibilidade', 'objecao_ativa', 'objecoes_levantadas',
  'tentativas_objecao_atual', 'aula_experimental_agendada', 'data_agendamento',
  'hora_agendamento', 'modalidade_agendada', 'primeira_mensagem_em',
  'ultima_mensagem_em', 'total_mensagens_lead', 'total_mensagens_johnny',
  'resumo_dinamico', 'resumo_dinamico_n_msgs', 'tags_sistema_ativas', 'is_aluno_existente',
  'encerrada_em', 'motivo_encerramento', 'modulo_pendente',
];

const VALID_ESTAGIOS = new Set([
  'qualificacao_inicial', 'qualificacao_objetivo', 'captura_nome',
  'recomendacao_modalidade', 'proposta_visita', 'drill_horario',
  'agendamento_confirmado', 'objecao_ativa', 'apresentacao_planos',
  'handoff_humano',
]);

const VALID_OBJETIVO = new Set(['', 'resultado_fisico', 'qualidade_vida', 'massa', 'emagrecer']);
const VALID_MODALIDADE = new Set(['', 'musculacao', 'pilates', 'personalizado']);
const VALID_DISPONIBILIDADE = new Set(['', 'manha', 'tarde']);
const VALID_OBJECAO = new Set(['', 'preco', 'tempo', 'pensar', 'adiar', 'mensal', 'pagamento', 'conjuge', 'distancia', 'convenio']);

function getLeadState(phone) {
  phone = canonicalizeContactPhone(phone);
  const row = db.prepare('SELECT * FROM lead_state WHERE phone = ?').get(phone);
  if (!row) return null;
  // Parse JSON arrays
  try { row.objecoes_levantadas = row.objecoes_levantadas ? JSON.parse(row.objecoes_levantadas) : []; } catch { row.objecoes_levantadas = []; }
  try { row.tags_sistema_ativas = row.tags_sistema_ativas ? JSON.parse(row.tags_sistema_ativas) : []; } catch { row.tags_sistema_ativas = []; }
  return row;
}

function getOrCreateLeadState(phone) {
  phone = canonicalizeContactPhone(phone);
  // Garante que contacts existe (FK)
  getOrCreateContact(phone);
  let s = getLeadState(phone);
  if (s) return s;
  const now = Date.now();
  db.prepare(`
    INSERT INTO lead_state (phone, estagio_atual, primeira_mensagem_em, ultima_mensagem_em, updated_at)
    VALUES (?, 'qualificacao_inicial', ?, ?, ?)
  `).run(phone, now, now, now);
  return getLeadState(phone);
}

// Update parcial — recebe { campo: valor, ... } e atualiza só os campos válidos.
// Faz validação de enum quando aplicável (campos inválidos são ignorados + logados).
function updateLeadState(phone, fields) {
  phone = canonicalizeContactPhone(phone);
  if (!fields || typeof fields !== 'object') return;
  const updates = [];
  const values = [];
  for (const [key, rawVal] of Object.entries(fields)) {
    if (!LEAD_STATE_FIELDS.includes(key)) continue;
    let val = rawVal;
    // Validação de enums (silenciosamente ignora valor inválido)
    if (key === 'estagio_atual' && val && !VALID_ESTAGIOS.has(val)) {
      console.warn(`[db] estagio_atual inválido ignorado: ${val}`);
      continue;
    }
    if (key === 'objetivo' && val && !VALID_OBJETIVO.has(val)) continue;
    if (key === 'modalidade_recomendada' && val && !VALID_MODALIDADE.has(val)) continue;
    if (key === 'disponibilidade' && val && !VALID_DISPONIBILIDADE.has(val)) continue;
    if (key === 'objecao_ativa' && val && !VALID_OBJECAO.has(val)) continue;
    // Campos JSON: serializa
    if (key === 'objecoes_levantadas' || key === 'tags_sistema_ativas') {
      val = JSON.stringify(Array.isArray(val) ? val : []);
    }
    // Booleans: 0/1
    if (key === 'aula_experimental_agendada' || key === 'is_aluno_existente') {
      val = val ? 1 : 0;
    }
    updates.push(`${key} = ?`);
    values.push(val);
  }
  if (!updates.length) return;
  updates.push('updated_at = ?');
  values.push(Date.now());
  values.push(phone);
  db.prepare(`UPDATE lead_state SET ${updates.join(', ')} WHERE phone = ?`).run(...values);
}

function incrementLeadStateCounter(phone, field, delta = 1, max = null) {
  phone = canonicalizeContactPhone(phone);
  if (!['insistencias_valor', 'tentativas_objecao_atual', 'total_mensagens_lead', 'total_mensagens_johnny'].includes(field)) return;
  const cur = db.prepare(`SELECT ${field} as v FROM lead_state WHERE phone = ?`).get(phone);
  if (!cur) return;
  let next = (cur.v || 0) + delta;
  if (max !== null && next > max) next = max;
  db.prepare(`UPDATE lead_state SET ${field} = ?, updated_at = ? WHERE phone = ?`).run(next, Date.now(), phone);
  return next;
}

function appendObjecaoLevantada(phone, objecao) {
  if (!objecao) return;
  const s = getLeadState(phone);
  if (!s) return;
  const arr = Array.isArray(s.objecoes_levantadas) ? s.objecoes_levantadas : [];
  if (!arr.includes(objecao)) arr.push(objecao);
  updateLeadState(phone, { objecoes_levantadas: arr });
}

function resetLeadState(phone) {
  phone = canonicalizeContactPhone(phone);
  db.prepare('DELETE FROM lead_state WHERE phone = ?').run(phone);
}

// ─────────────────────────────────────────────────────────────────────
// AGENT V2 — prompt_modules (CRUD dos 28 módulos)
// ─────────────────────────────────────────────────────────────────────

function getAllPromptModules() {
  return db.prepare(`
    SELECT name, title, content, category, active, updated_at, updated_by
    FROM prompt_modules
    ORDER BY category, name
  `).all();
}

function getPromptModule(name) {
  return db.prepare('SELECT * FROM prompt_modules WHERE name = ? AND active = 1').get(name) || null;
}

function getPromptModuleContents(names) {
  if (!Array.isArray(names) || !names.length) return [];
  const placeholders = names.map(() => '?').join(',');
  return db.prepare(`
    SELECT name, title, content FROM prompt_modules
    WHERE name IN (${placeholders}) AND active = 1
  `).all(...names);
}

function upsertPromptModule({ name, title, content, category }, userId = null) {
  if (!name || !content) throw new Error('name e content obrigatórios');
  db.prepare(`
    INSERT INTO prompt_modules (name, title, content, category, active, updated_at, updated_by)
    VALUES (?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      title = excluded.title,
      content = excluded.content,
      category = COALESCE(excluded.category, prompt_modules.category),
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(name, title || name, content, category || null, Date.now(), userId);
}

function setPromptModuleActive(name, active, userId = null) {
  db.prepare('UPDATE prompt_modules SET active = ?, updated_at = ?, updated_by = ? WHERE name = ?')
    .run(active ? 1 : 0, Date.now(), userId, name);
}

// Seed inicial dos módulos — popula só se a tabela estiver vazia.
// Conteúdo dos 28 módulos vem de src/prompt-modules-seed.js
function seedPromptModulesIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) as c FROM prompt_modules').get().c;
  if (count > 0) return 0;
  const seed = require('./prompt-modules-seed');
  const stmt = db.prepare(`
    INSERT INTO prompt_modules (name, title, content, category, active, updated_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `);
  const tx = db.transaction((items) => {
    for (const m of items) {
      stmt.run(m.name, m.title || m.name, m.content, m.category || null, Date.now());
    }
  });
  tx(seed);
  console.log(`[db] seed inicial de prompt_modules: ${seed.length} módulos inseridos`);
  return seed.length;
}

// ─────────────────────────────────────────────────────────────────────
// KNOWLEDGE BASE — academia_info (planos, horários, modalidades, promo)
// ─────────────────────────────────────────────────────────────────────

function getAllAcademiaInfo() {
  return db.prepare(`
    SELECT key, value, label, description, category, display_order, updated_at, updated_by
    FROM academia_info
    ORDER BY category, display_order, key
  `).all();
}

function getAcademiaInfoMap() {
  const rows = getAllAcademiaInfo();
  const map = {};
  for (const r of rows) map[r.key] = r.value || '';
  return map;
}

function setAcademiaInfo(key, value, userId = null) {
  // Atualiza valor (não permite criar chave nova via essa função; usa upsert se quiser)
  const r = db.prepare(`
    UPDATE academia_info SET value = ?, updated_at = ?, updated_by = ? WHERE key = ?
  `).run(String(value || ''), Date.now(), userId || null, key);
  return r.changes > 0;
}

// Monta o bloco de texto que vai injetado no prompt da IA com as infos atuais
// da academia. Só inclui categorias que têm pelo menos 1 valor preenchido,
// pra não poluir o prompt com seções vazias.
function buildAcademiaInfoBlock() {
  const rows = getAllAcademiaInfo().filter(r => r.value && r.value.trim());
  if (!rows.length) return '';
  const byCategory = {};
  for (const r of rows) {
    if (!byCategory[r.category]) byCategory[r.category] = [];
    byCategory[r.category].push(r);
  }
  const CAT_LABEL = {
    planos: 'PLANOS E VALORES',
    estrutura: 'ESTRUTURA / MODALIDADES',
    horarios: 'HORÁRIOS DE FUNCIONAMENTO',
    contato: 'LOCALIZAÇÃO E CONTATO',
    promo: 'PROMO ATUAL',
    institucional: 'DIFERENCIAIS',
  };
  let out = '\n\n═══ INFORMAÇÕES ATUAIS DA STRONIX (atualizadas pela equipe) ═══\n';
  out += 'Use estes valores em conversas com leads. Em caso de conflito com qualquer outra info no prompt, ESTES valem porque são gerenciados pela equipe.\n';
  for (const cat of ['promo','planos','estrutura','horarios','contato','institucional']) {
    if (!byCategory[cat]) continue;
    out += '\n' + (CAT_LABEL[cat] || cat.toUpperCase()) + ':\n';
    for (const r of byCategory[cat]) {
      out += '- ' + (r.label || r.key) + ': ' + r.value + '\n';
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// PR #37 — V2 monitoring: helpers de log, métricas, alertas e flags runtime
// ─────────────────────────────────────────────────────────────────────

// Tipos de evento conhecidos. Usado como contrato com agent-v2 e admin UI.
const V2_EVENT_TYPES = {
  TAG_ESQUECIDA: 'tag_esquecida',           // parser não achou [ESTADO:] na resposta
  ROUTER_EMPTY: 'router_empty',             // routeModules() retornou []
  PRECO_INVENTADO: 'preco_inventado',       // bot mencionou preço fora do academia_info
  VALOR_ANTECIPADO: 'valor_antecipado',     // bot passou valor antes de insistencias_valor=3
  CRASH: 'crash',                           // exception não tratada em replyV2
  VERSION_CHANGE: 'version_change',         // pausa/resume v2
  FORCE_RESUMO: 'force_resumo',             // admin forçou geração de resumo
  TURN_OK: 'turn_ok',                       // turno completo sem flag — denominador pra %
};

// Append-only log de eventos. Performance OK pra ~10k events/dia.
function logV2Event(eventType, phone = null, value = null, meta = null) {
  try {
    const metaStr = meta ? (typeof meta === 'string' ? meta : JSON.stringify(meta)) : null;
    db.prepare(`
      INSERT INTO v2_metrics_log (timestamp, event_type, phone, value, meta)
      VALUES (?, ?, ?, ?, ?)
    `).run(Date.now(), eventType, phone, value, metaStr);
  } catch (e) {
    console.error('[db] logV2Event falhou:', e.message);
  }
}

// Janelas de tempo (ms) pra filtros do painel.
const V2_PERIODS = {
  '1h': 60 * 60 * 1000,
  'today': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '14d': 14 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

function periodToMs(period) {
  return V2_PERIODS[period] || V2_PERIODS['7d'];
}

// Conta eventos de um tipo dentro de janela.
function countV2Events(eventType, periodMs) {
  const since = Date.now() - periodMs;
  const row = db.prepare(`
    SELECT COUNT(*) as c FROM v2_metrics_log
    WHERE event_type = ? AND timestamp >= ?
  `).get(eventType, since);
  return row?.c || 0;
}

// Lista eventos crus pra debug / auditoria. Limit defensivo.
function listV2Events(eventType = null, periodMs = null, limit = 200) {
  const since = periodMs ? Date.now() - periodMs : 0;
  let sql = `SELECT id, timestamp, event_type, phone, value, meta FROM v2_metrics_log WHERE timestamp >= ?`;
  const params = [since];
  if (eventType) { sql += ' AND event_type = ?'; params.push(eventType); }
  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params).map(r => {
    if (r.meta) { try { r.meta = JSON.parse(r.meta); } catch { /* keep string */ } }
    return r;
  });
}

// Conversas v2 ativas — heurística: tem row em lead_state (v2 cria, v1 não).
// Inclui filtro de status: em_andamento / agendou / handoff / perdeu.
// "perdeu" = sem msg há >24h E não atingiu agendamento_confirmado nem handoff_humano.
function getV2Conversations({ status = null, limit = 200 } = {}) {
  const PERDIDO_THRESHOLD = 24 * 60 * 60 * 1000;
  const now = Date.now();
  // JOIN lead_state (v2) + contacts + última msg + review
  const rows = db.prepare(`
    SELECT
      ls.phone,
      c.name,
      c.last_contact_at,
      ls.estagio_atual,
      ls.objecao_ativa,
      ls.insistencias_valor,
      ls.modalidade_recomendada,
      ls.disponibilidade,
      ls.modulo_pendente,
      ls.total_mensagens_lead,
      ls.total_mensagens_johnny,
      ls.aula_experimental_agendada,
      ls.data_agendamento,
      ls.hora_agendamento,
      ls.resumo_dinamico_n_msgs,
      r.rating as review_rating,
      r.comment as review_comment,
      (SELECT content FROM messages WHERE phone = ls.phone ORDER BY id DESC LIMIT 1) as last_message
    FROM lead_state ls
    LEFT JOIN contacts c ON c.phone = ls.phone
    LEFT JOIN conversation_reviews r ON r.phone = ls.phone
    ORDER BY c.last_contact_at DESC
    LIMIT ?
  `).all(limit);

  // Calcula status derivado e mascara phone.
  for (const r of rows) {
    const idle = r.last_contact_at ? now - r.last_contact_at : Infinity;
    if (r.estagio_atual === 'agendamento_confirmado') r._status = 'agendou';
    else if (r.estagio_atual === 'handoff_humano') r._status = 'handoff';
    else if (idle > PERDIDO_THRESHOLD) r._status = 'perdeu';
    else r._status = 'em_andamento';
    r._phone_masked = maskPhone(r.phone);
  }
  if (status) return rows.filter(r => r._status === status);
  return rows;
}

// Mascara últimos 4 dígitos pra UI: 5551995304633 → 5551995****
function maskPhone(phone) {
  if (!phone || phone.length < 4) return phone;
  return phone.slice(0, -4) + '****';
}

// Detalhe completo de uma conversa pra painel lateral.
function getV2ConversationDetail(phone) {
  phone = canonicalizeContactPhone(phone);
  const state = getLeadState(phone);
  if (!state) return null;
  const contact = getContact(phone);
  const messages = stmts.getMessagesForContact.all(phone).map(m => ({
    role: m.role,
    content: m.content,
    was_audio: m.was_audio,
    delivery_status: m.delivery_status,
    created_at: m.created_at,
  }));
  const review = db.prepare('SELECT * FROM conversation_reviews WHERE phone = ?').get(phone);
  // Pega últimos eventos relacionados a esse phone (tag esquecida etc)
  const events = db.prepare(`
    SELECT timestamp, event_type, value, meta FROM v2_metrics_log
    WHERE phone = ? ORDER BY timestamp DESC LIMIT 50
  `).all(phone).map(e => {
    if (e.meta) { try { e.meta = JSON.parse(e.meta); } catch {} }
    return e;
  });
  return {
    phone,
    phone_masked: maskPhone(phone),
    contact,
    state,
    messages,
    review,
    events,
  };
}

// Métricas agregadas pro dashboard.
function getV2Metrics(period = '7d') {
  const periodMs = periodToMs(period);
  const since = Date.now() - periodMs;

  // Funil baseado em estagio_atual de leads que tiveram atividade no período
  const funilRows = db.prepare(`
    SELECT ls.estagio_atual, COUNT(DISTINCT ls.phone) as c
    FROM lead_state ls
    LEFT JOIN contacts c ON c.phone = ls.phone
    WHERE c.last_contact_at >= ?
    GROUP BY ls.estagio_atual
  `).all(since);
  const funil = {};
  let totalLeads = 0;
  for (const r of funilRows) {
    funil[r.estagio_atual] = r.c;
    totalLeads += r.c;
  }

  const agendou = funil['agendamento_confirmado'] || 0;
  const handoff = funil['handoff_humano'] || 0;
  // Perdidos: tem lead_state, last_contact >24h atrás, mas não chegou em agendou/handoff
  const perdidos = db.prepare(`
    SELECT COUNT(DISTINCT ls.phone) as c FROM lead_state ls
    LEFT JOIN contacts c ON c.phone = ls.phone
    WHERE c.last_contact_at >= ?
      AND c.last_contact_at < ?
      AND ls.estagio_atual NOT IN ('agendamento_confirmado', 'handoff_humano')
  `).get(since, Date.now() - 24 * 60 * 60 * 1000).c || 0;

  // Eventos de qualidade
  const turnsOk = countV2Events(V2_EVENT_TYPES.TURN_OK, periodMs);
  const tagEsquecida = countV2Events(V2_EVENT_TYPES.TAG_ESQUECIDA, periodMs);
  const routerEmpty = countV2Events(V2_EVENT_TYPES.ROUTER_EMPTY, periodMs);
  const totalTurns = turnsOk + tagEsquecida;
  const precoInventado = countV2Events(V2_EVENT_TYPES.PRECO_INVENTADO, periodMs);
  const valorAntecipado = countV2Events(V2_EVENT_TYPES.VALOR_ANTECIPADO, periodMs);
  const crashes = countV2Events(V2_EVENT_TYPES.CRASH, periodMs);

  // Tempo médio do primeiro contato até agendou
  const tempoMedio = db.prepare(`
    SELECT AVG(c.last_contact_at - c.first_contact_at) as avg_ms
    FROM lead_state ls
    LEFT JOIN contacts c ON c.phone = ls.phone
    WHERE ls.estagio_atual = 'agendamento_confirmado'
      AND c.last_contact_at >= ?
  `).get(since).avg_ms;

  return {
    period,
    since,
    total_leads: totalLeads,
    funil,
    pct_agendou: totalLeads ? (agendou / totalLeads) * 100 : 0,
    pct_handoff: totalLeads ? (handoff / totalLeads) * 100 : 0,
    pct_perdeu: totalLeads ? (perdidos / totalLeads) * 100 : 0,
    pct_tag_esquecida: totalTurns ? (tagEsquecida / totalTurns) * 100 : 0,
    pct_router_empty: totalTurns ? (routerEmpty / totalTurns) * 100 : 0,
    total_turns: totalTurns,
    crashes,
    preco_inventado: precoInventado,
    valor_antecipado: valorAntecipado,
    tempo_medio_ate_agendou_ms: tempoMedio || null,
  };
}

// Calcula alertas ativos baseado nos critérios do PR37.
// Retorna array de { level: 'critical'|'warning', code, message, context }.
function getV2Alerts() {
  const alerts = [];

  // 1. 3 reviews ❌ seguidas (mais recentes)
  const last3Bad = db.prepare(`
    SELECT phone, rating FROM conversation_reviews
    ORDER BY reviewed_at DESC LIMIT 3
  `).all();
  if (last3Bad.length === 3 && last3Bad.every(r => r.rating === 'bad')) {
    alerts.push({
      level: 'critical',
      code: 'three_bad_reviews',
      message: '3 conversas seguidas marcadas ❌',
      context: { phones: last3Bad.map(r => maskPhone(r.phone)) },
    });
  }

  // 2-4. Eventos críticos nas últimas 24h
  const period24h = 24 * 60 * 60 * 1000;
  const precoInv = countV2Events(V2_EVENT_TYPES.PRECO_INVENTADO, period24h);
  if (precoInv > 0) {
    alerts.push({
      level: 'critical',
      code: 'preco_inventado',
      message: `Bot inventou preço/regra ${precoInv}x nas últimas 24h`,
      context: { count: precoInv },
    });
  }
  const valorAnt = countV2Events(V2_EVENT_TYPES.VALOR_ANTECIPADO, period24h);
  if (valorAnt > 0) {
    alerts.push({
      level: 'critical',
      code: 'valor_antecipado',
      message: `Bot passou valor antes da 3ª insistência ${valorAnt}x nas últimas 24h`,
      context: { count: valorAnt },
    });
  }

  // 3. Tag esquecida em >30% das primeiras 20 conversas v2 (rolling)
  const last20 = db.prepare(`
    SELECT DISTINCT phone FROM lead_state ORDER BY primeira_mensagem_em DESC LIMIT 20
  `).all().map(r => r.phone);
  if (last20.length >= 20) {
    const placeholders = last20.map(() => '?').join(',');
    const tagFalhas = db.prepare(`
      SELECT COUNT(*) as c FROM v2_metrics_log
      WHERE event_type = ? AND phone IN (${placeholders})
    `).get(V2_EVENT_TYPES.TAG_ESQUECIDA, ...last20).c;
    const totalTurnsLast20 = db.prepare(`
      SELECT COUNT(*) as c FROM v2_metrics_log
      WHERE event_type IN (?, ?) AND phone IN (${placeholders})
    `).get(V2_EVENT_TYPES.TAG_ESQUECIDA, V2_EVENT_TYPES.TURN_OK, ...last20).c;
    if (totalTurnsLast20 > 0) {
      const pct = (tagFalhas / totalTurnsLast20) * 100;
      if (pct > 30) {
        alerts.push({
          level: 'warning',
          code: 'tag_esquecida_alta',
          message: `Tag [ESTADO:] esquecida em ${pct.toFixed(1)}% das últimas 20 conversas (limite 30%)`,
          context: { pct, total: totalTurnsLast20, falhas: tagFalhas },
        });
      }
    }
  }

  // 5. Crashes nas últimas 24h
  const crashes = countV2Events(V2_EVENT_TYPES.CRASH, period24h);
  if (crashes > 0) {
    alerts.push({
      level: 'critical',
      code: 'crash',
      message: `Agente crashou ${crashes}x nas últimas 24h`,
      context: { count: crashes },
    });
  }

  return alerts;
}

// Runtime flags persistidos em DB. Sobreviem restart.
function getRuntimeFlag(key) {
  const row = db.prepare('SELECT value FROM v2_runtime_flags WHERE key = ?').get(key);
  return row?.value || null;
}

function setRuntimeFlag(key, value, userId = null) {
  db.prepare(`
    INSERT INTO v2_runtime_flags (key, value, updated_at, updated_by)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(key, value, Date.now(), userId);
}

// Estende a validação atual de upsertReview pra aceitar 'aceitavel'.
const VALID_REVIEW_RATINGS = new Set(['good', 'aceitavel', 'bad']);
function isValidReviewRating(rating) {
  return VALID_REVIEW_RATINGS.has(rating);
}

// ─── Boot: seed inicial de prompt_modules (se vazio) ───
try {
  seedPromptModulesIfEmpty();
} catch (e) {
  console.error('[db] erro ao seedar prompt_modules:', e.message);
}

module.exports = {
  getContact,
  getOrCreateContact,
  canonicalizeContactPhone,
  setContactName,
  updateLastContact,
  updateAudioFlags,
  addMessage,
  getHistory,
  getAllMessages,
  getContact,
  getMessageCount,
  getDaysSinceLastContact,
  getAllConversations,
  clearConversation,
  createAppointment,
  getAppointments,
  getAppointmentsByPhone,
  updateAppointmentStatus,
  upsertReview,
  getReview,
  getAllReviews,
  deleteReview,
  upsertStudent,
  getStudent,
  isStudent,
  getAllStudents,
  deleteStudent,
  bulkUpsertStudents,
  // users + auth
  createUser,
  authenticateUser,
  getUserById,
  getAllUsers,
  setUserActive,
  setUserPassword,
  setUserRole,
  setUserPhone,
  setUserDisplayName,
  deleteUser,
  countUsers,
  countAdmins,
  getActiveConsultors,
  getActiveAdmins,
  // sessions
  createSession,
  getSessionUser,
  deleteSession,
  cleanExpiredSessions,
  // assignment
  assumeConversation,
  releaseConversation,
  getContactAssignment,
  addMessageWithSender,
  setLastAssistantMessageMediaPath,
  updateMessageDeliveryStatus,
  // Knowledge base
  getAllAcademiaInfo,
  getAcademiaInfoMap,
  setAcademiaInfo,
  buildAcademiaInfoBlock,
  // Agent v2 — lead_state
  getLeadState,
  getOrCreateLeadState,
  updateLeadState,
  incrementLeadStateCounter,
  appendObjecaoLevantada,
  resetLeadState,
  // Agent v2 — prompt_modules
  getAllPromptModules,
  getPromptModule,
  getPromptModuleContents,
  upsertPromptModule,
  setPromptModuleActive,
  seedPromptModulesIfEmpty,
  // metrics
  getMetrics,
  // PR #37 — V2 monitoring
  V2_EVENT_TYPES,
  V2_PERIODS,
  logV2Event,
  countV2Events,
  listV2Events,
  getV2Conversations,
  getV2ConversationDetail,
  getV2Metrics,
  getV2Alerts,
  getRuntimeFlag,
  setRuntimeFlag,
  isValidReviewRating,
  maskPhone,
};
