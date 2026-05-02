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
`);

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

module.exports = {
  getContact,
  getOrCreateContact,
  canonicalizeContactPhone,
  setContactName,
  updateLastContact,
  updateAudioFlags,
  addMessage,
  getHistory,
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
  // metrics
  getMetrics,
};
