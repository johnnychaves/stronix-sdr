// Cliente Baileys — substitui Meta Cloud API quando WHATSAPP_PROVIDER=baileys.
// Mantém uma conexão WebSocket com WhatsApp e expõe API equivalente
// pro resto do código (sendMessage, sendVoice, downloadMedia).
//
// Auth state persiste em /data/baileys-auth/ (volume Railway).
// Reconecta sozinho se cair (exceto se logout explícito).

const baileys = require('@whiskeysockets/baileys');
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} = baileys;
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const pino = require('pino');

const AUTH_DIR = process.env.BAILEYS_AUTH_DIR || (() => {
  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'database.sqlite');
  return path.join(path.dirname(dbPath), 'baileys-auth');
})();

if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

let sock = null;
let lastQRDataUrl = null;     // QR PNG data URL pro painel
let connectionStatus = 'connecting'; // connecting | qr | open | close
let lastDisconnectReason = null;
let onMessageCallback = null;
let connectedSince = null;
const logger = pino({ level: 'silent' });

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`[baileys] iniciando — protocol v${version.join('.')}, latest=${isLatest}`);

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger,
    browser: ['STRONIX SDR', 'Chrome', '1.0.0'],
    syncFullHistory: false,
    markOnlineOnConnect: true,
    generateHighQualityLinkPreview: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        lastQRDataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 2 });
        connectionStatus = 'qr';
        console.log('[baileys] 📱 QR code disponível em /admin/api/baileys/qr — escaneia com o WhatsApp');
      } catch (e) {
        console.error('[baileys] erro ao gerar QR:', e.message);
      }
    }

    if (connection === 'open') {
      lastQRDataUrl = null;
      connectionStatus = 'open';
      connectedSince = Date.now();
      const me = sock.user?.id?.split(':')[0] || sock.user?.id || 'desconhecido';
      console.log(`[baileys] ✓ conectado como ${me}`);
    }

    if (connection === 'close') {
      const reason = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output?.statusCode
        : null;
      lastDisconnectReason = reason;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;
      console.log(`[baileys] desconectou (reason=${reason}). reconectar=${shouldReconnect}`);
      connectionStatus = 'close';
      connectedSince = null;
      if (shouldReconnect) {
        setTimeout(() => start().catch(e => console.error('[baileys] reconexão falhou:', e.message)), 3000);
      } else {
        // Logged out — apaga auth state e exige novo QR
        console.log('[baileys] sessão terminada (logout). Apagando auth state, próximo start exige QR.');
        try {
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          fs.mkdirSync(AUTH_DIR, { recursive: true });
        } catch (e) {
          console.error('[baileys] erro ao limpar auth:', e.message);
        }
      }
    }
  });

  // Status updates (sent/delivered/read) — mapeia pra checkmarks no painel
  sock.ev.on('messages.update', async (updates) => {
    const db = require('./db');
    for (const u of updates) {
      const wamid = u.key?.id;
      if (!wamid) continue;
      // WAMessageStatus: 1=pending, 2=server_ack(sent), 3=delivery_ack(delivered), 4=read, 5=played
      const s = u.update?.status;
      let status = null;
      if (s === 2) status = 'sent';
      else if (s === 3) status = 'delivered';
      else if (s === 4 || s === 5) status = 'read';
      if (status) {
        try {
          db.updateMessageDeliveryStatus(wamid, status, Math.floor(Date.now() / 1000));
        } catch (e) {
          console.error('[baileys] erro update status:', e.message);
        }
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      // Ignora mensagens enviadas por nós mesmos
      if (msg.key.fromMe) continue;
      // Ignora msgs de grupo (academia atende 1-a-1 só)
      if (msg.key.remoteJid?.endsWith('@g.us')) continue;
      // Ignora status broadcasts
      if (msg.key.remoteJid === 'status@broadcast') continue;

      if (!onMessageCallback) {
        console.warn('[baileys] msg recebida mas sem handler registrado — ignorando');
        continue;
      }

      try {
        await onMessageCallback(msg, sock);
      } catch (e) {
        console.error('[baileys] erro processando msg:', e.message);
      }
    }
  });
}

// Converte phone (5551995304633) → JID (5551995304633@s.whatsapp.net)
function jidOf(phone) {
  const clean = String(phone).replace(/\D/g, '');
  return `${clean}@s.whatsapp.net`;
}

// Extrai phone (5551995304633) do JID (5551995304633@s.whatsapp.net)
function phoneOf(jid) {
  return String(jid).split('@')[0].split(':')[0];
}

// Cache de LID → phone (preenchido conforme descobrimos mappings)
const lidToPhone = new Map();

// Extrai o phone "canônico" da chave de uma mensagem.
// Trata o caso de privacidade do WhatsApp Multi-Device onde remoteJid pode ser
// '<lid>@lid' em vez de '<phone>@s.whatsapp.net'. Tenta vários campos
// fallback que o Baileys popula em versões recentes:
//   - key.remoteJidAlt (PN alternativo)
//   - key.senderPn / key.participantPn
//   - cache lidToPhone (preenchido em encontros anteriores)
function extractPhoneFromKey(key) {
  if (!key) return null;
  const r = key.remoteJid || '';

  // Caso 1: JID padrão com phone
  if (r.endsWith('@s.whatsapp.net')) {
    return r.split('@')[0].split(':')[0];
  }

  // Caso 2: LID (privacy) — tenta resolver
  if (r.endsWith('@lid')) {
    const lid = r.split('@')[0];

    // Cache hit?
    if (lidToPhone.has(lid)) return lidToPhone.get(lid);

    // remoteJidAlt costuma ser o PN equivalente
    if (key.remoteJidAlt && /@s\.whatsapp\.net$/.test(key.remoteJidAlt)) {
      const pn = key.remoteJidAlt.split('@')[0].split(':')[0];
      lidToPhone.set(lid, pn);
      return pn;
    }
    if (key.senderPn) {
      const pn = String(key.senderPn).replace(/[^0-9]/g, '');
      if (pn) { lidToPhone.set(lid, pn); return pn; }
    }
    if (key.participantPn) {
      const pn = String(key.participantPn).replace(/[^0-9]/g, '');
      if (pn) { lidToPhone.set(lid, pn); return pn; }
    }

    // Não conseguiu resolver — loga estrutura completa da key pra diagnóstico
    console.warn('[baileys] LID não resolvido:', JSON.stringify(key));
    return lid; // fallback (vai criar contato separado pelo LID)
  }

  // Caso 3: outros (group @g.us, broadcast etc) — extrai o que dá
  return r.split('@')[0].split(':')[0];
}

async function ensureConnected() {
  if (!sock) throw new Error('Baileys ainda não foi inicializado');
  if (connectionStatus !== 'open') {
    throw new Error(`Baileys não conectado (status=${connectionStatus}). Escaneia o QR em /admin/api/baileys/qr.`);
  }
}

// Resolve o JID canônico no servidor WhatsApp. Lida com o bug do 9º dígito BR:
// número pode estar registrado como 12 dígitos (sem o 9) ou 13 dígitos (com o 9),
// e mandar pro errado faz a msg ser silenciosamente descartada.
//
// Estratégia: tenta o input bruto, depois variações com/sem 9. Pega o primeiro
// que o WhatsApp confirmar que existe.
async function resolveJid(to) {
  const clean = String(to).replace(/\D/g, '');
  const candidates = [clean];
  // BR mobile: gera variação com/sem 9
  if (clean.startsWith('55') && clean.length === 13) {
    // Tem o 9 — adiciona variação sem o 9
    candidates.push(clean.slice(0, 4) + clean.slice(5));
  } else if (clean.startsWith('55') && clean.length === 12) {
    // Não tem o 9 — adiciona variação com o 9
    candidates.push(clean.slice(0, 4) + '9' + clean.slice(4));
  }
  const jids = candidates.map(c => `${c}@s.whatsapp.net`);

  try {
    const results = await sock.onWhatsApp(...jids);
    if (Array.isArray(results) && results.length) {
      const found = results.find(r => r.exists);
      if (found) {
        if (found.jid !== jids[0]) {
          console.log(`[baileys] JID resolvido ${jids[0]} → ${found.jid} (variação BR 9-dígito)`);
        }
        return found.jid;
      }
      console.warn(`[baileys] ⚠️ ${to} não tem WhatsApp ativo (testou ${candidates.length} formatos)`);
    }
  } catch (e) {
    console.warn('[baileys] erro em onWhatsApp, vai tentar enviar sem validar:', e.message);
  }
  return jids[0]; // fallback — tenta o input original
}

async function sendMessage(to, text) {
  await ensureConnected();
  const targetJid = await resolveJid(to);
  const result = await sock.sendMessage(targetJid, { text });
  console.log(`[baileys] sendMessage → ${targetJid} (id=${result?.key?.id || 'sem-id'}, ${text.length} chars)`);
  return { messages: [{ id: result?.key?.id || null }] };
}

// Envia áudio como voz (PTT — push-to-talk, aparece como "voice message")
async function sendAudio(to, audioBuffer, mimeType = 'audio/ogg; codecs=opus') {
  await ensureConnected();
  const targetJid = await resolveJid(to);
  const result = await sock.sendMessage(targetJid, {
    audio: audioBuffer,
    mimetype: mimeType,
    ptt: true,
  });
  console.log(`[baileys] sendAudio → ${targetJid} (id=${result?.key?.id || 'sem-id'}, ${audioBuffer.length} bytes)`);
  return { messages: [{ id: result?.key?.id || null }] };
}

// Baixa mídia de uma mensagem recebida (Buffer)
async function downloadMedia(msg) {
  return await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
}

function getStatus() {
  return {
    status: connectionStatus,
    qr: connectionStatus === 'qr' ? lastQRDataUrl : null,
    connectedSince,
    me: sock?.user?.id ? phoneOf(sock.user.id) : null,
    lastDisconnectReason,
  };
}

function setMessageHandler(cb) {
  onMessageCallback = cb;
}

// Desconecta e apaga sessão local — usado pra trocar de número
// (ex: testar com pessoal, depois conectar com número da academia).
// Após chamar, o setTimeout reconecta sozinho e gera novo QR.
async function disconnect() {
  try {
    if (sock) {
      try { await sock.logout(); } catch (e) { /* logout pode falhar se já caído */ }
    }
  } catch {}
  try {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  } catch (e) {
    console.error('[baileys] erro ao limpar auth:', e.message);
  }
  connectionStatus = 'connecting';
  lastQRDataUrl = null;
  connectedSince = null;
  // Reinicia conexão (vai gerar novo QR)
  setTimeout(() => start().catch(e => console.error('[baileys] erro ao reconectar pós-logout:', e.message)), 1500);
  console.log('[baileys] sessão desconectada — gerando novo QR...');
}

// Para uso externo (ex: webhook converter precisa parsear msg)
function extractMessageBody(msg) {
  const m = msg.message || {};
  // text
  if (m.conversation) return { type: 'text', text: m.conversation };
  if (m.extendedTextMessage?.text) return { type: 'text', text: m.extendedTextMessage.text };
  // audio (voice message)
  if (m.audioMessage) return { type: 'audio', audioMessage: m.audioMessage };
  // image with caption (treat caption as text)
  if (m.imageMessage?.caption) return { type: 'text', text: m.imageMessage.caption };
  // unsupported
  return { type: 'unsupported', raw: Object.keys(m) };
}

module.exports = {
  start,
  sendMessage,
  sendAudio,
  downloadMedia,
  getStatus,
  setMessageHandler,
  extractMessageBody,
  extractPhoneFromKey,
  phoneOf,
  jidOf,
  disconnect,
};
