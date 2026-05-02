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

async function ensureConnected() {
  if (!sock) throw new Error('Baileys ainda não foi inicializado');
  if (connectionStatus !== 'open') {
    throw new Error(`Baileys não conectado (status=${connectionStatus}). Escaneia o QR em /admin/api/baileys/qr.`);
  }
}

async function sendMessage(to, text) {
  await ensureConnected();
  const result = await sock.sendMessage(jidOf(to), { text });
  return { messages: [{ id: result?.key?.id || null }] };
}

// Envia áudio como voz (PTT — push-to-talk, aparece como "voice message")
async function sendAudio(to, audioBuffer, mimeType = 'audio/ogg; codecs=opus') {
  await ensureConnected();
  const result = await sock.sendMessage(jidOf(to), {
    audio: audioBuffer,
    mimetype: mimeType,
    ptt: true,
  });
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
  phoneOf,
  jidOf,
};
