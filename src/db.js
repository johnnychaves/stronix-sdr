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
};

// ─────────────────────────────────────────────────────────────────────
// API PÚBLICA
// ─────────────────────────────────────────────────────────────────────

function getContact(phone) {
  return stmts.getContact.get(phone) || null;
}

function getOrCreateContact(phone) {
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
  stmts.updateLastContact.run(Date.now(), phone);
}

function updateAudioFlags(phone, { audioPermission, awaitingAudioConfirm, askedForAudio }) {
  stmts.updateAudioFlags.run(
    audioPermission ? 1 : 0,
    awaitingAudioConfirm ? 1 : 0,
    askedForAudio ? 1 : 0,
    phone
  );
}

function addMessage(phone, role, content, wasAudio = false) {
  stmts.insertMessage.run(phone, role, content, wasAudio ? 1 : 0, Date.now());
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
    const history = stmts.getMessagesForContact.all(c.phone);
    const lastMessage = history.length > 0 ? history[history.length - 1] : null;
    const review = stmts.getReview.get(c.phone) || null;
    return {
      from: c.phone,
      fromDisplay: c.phone.slice(0, 2) + '...' + c.phone.slice(-4),
      name: c.name,
      messageCount: history.length,
      audioPermission: !!c.audio_permission,
      firstContactAt: c.first_contact_at,
      lastContactAt: c.last_contact_at,
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
};
