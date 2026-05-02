// Event bus singleton — usado pra propagar eventos do core (DB writes, Baileys
// state) pro endpoint SSE no admin.js. Frontend escuta via EventSource e
// atualiza o painel em tempo real (latência ~100ms vs ~5s do polling).
//
// Throttling: writes sucessivos no mesmo phone (ex: typing indicator + msg
// arrived + status update) são coalescidos em 1 event "conversation.changed"
// num pequeno debounce, evitando flood pro frontend.

const { EventEmitter } = require('events');

class AppEventBus extends EventEmitter {}

const bus = new AppEventBus();
// 50 conexões SSE simultâneas (consultoras + admins logados ao mesmo tempo)
bus.setMaxListeners(100);

// ─── Throttle / coalesce per phone ───
const pendingConv = new Map(); // phone -> timeout
const COALESCE_MS = 250;

function emitConversationChanged(phone) {
  if (!phone) {
    // Sem phone específico = atualização geral (lista, sort, etc)
    bus.emit('conversation.changed', { phone: null });
    return;
  }
  if (pendingConv.has(phone)) return; // já agendado
  const t = setTimeout(() => {
    pendingConv.delete(phone);
    bus.emit('conversation.changed', { phone });
  }, COALESCE_MS);
  pendingConv.set(phone, t);
}

function emitConnectionsChanged() {
  bus.emit('connections.changed');
}

function emitAppointmentsChanged() {
  bus.emit('appointments.changed');
}

function emitStudentsChanged() {
  bus.emit('students.changed');
}

// Alerta operacional — toast no painel + browser notification.
// severity: 'info' | 'warn' | 'error'
function emitAlert({ severity = 'warn', title, message, code = null }) {
  bus.emit('alert', { severity, title, message, code, ts: Date.now() });
}

module.exports = {
  bus,
  emitConversationChanged,
  emitConnectionsChanged,
  emitAppointmentsChanged,
  emitStudentsChanged,
  emitAlert,
};
