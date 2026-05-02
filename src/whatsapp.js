// Facade — escolhe entre Meta Cloud API ou Baileys conforme env var.
// Resto do código (agent.js, webhook.js, admin.js, tts.js) usa só este módulo.
//
// WHATSAPP_PROVIDER=meta (default)  → Cloud API oficial (24h window, templates)
// WHATSAPP_PROVIDER=baileys         → Baileys (WhatsApp Web protocol, sem janela)

const PROVIDER = (process.env.WHATSAPP_PROVIDER || 'meta').toLowerCase();

const meta = require('./whatsapp-meta');
let baileys = null;
if (PROVIDER === 'baileys') {
  baileys = require('./whatsapp-baileys');
}

console.log(`[whatsapp] provider ativo: ${PROVIDER}`);

// ─── Send text ───
async function sendMessage(to, text) {
  if (PROVIDER === 'baileys') return await baileys.sendMessage(to, text);
  return await meta.sendMessage(to, text);
}

// ─── Send voice (audio) ───
// Baileys: aceita buffer + mime direto.
// Meta: precisa upload + sendAudio com media_id.
// Esta função abstrai a diferença — chamadores passam apenas (phone, buffer, mime).
async function sendVoice(to, audioBuffer, mimeType, filename = 'voice.mp3') {
  if (PROVIDER === 'baileys') {
    // Baileys aceita áudio em qualquer formato suportado pelo WhatsApp;
    // recomenda-se ogg/opus pra ficar como voice message verdadeira.
    // O áudio é transcodado pra ogg/opus pelo caller (transcodeAudio).
    return await baileys.sendAudio(to, audioBuffer, mimeType);
  }
  // Meta: 2 etapas (upload pra obter media_id, depois envia)
  const mediaId = await meta.uploadMedia(audioBuffer, mimeType, filename);
  return await meta.sendAudio(to, mediaId);
}

// ─── Download de mídia recebida ───
// Meta: recebe media_id, busca URL via API, baixa.
// Baileys: recebe a msg inteira, descriptografa o conteúdo.
// transcribeAudio sempre vai chamar isto e receber Buffer.
async function downloadMediaBuffer(messageOrId) {
  if (PROVIDER === 'baileys') {
    if (!messageOrId || typeof messageOrId === 'string') {
      throw new Error('Baileys downloadMediaBuffer espera o objeto da mensagem inteira');
    }
    return await baileys.downloadMedia(messageOrId);
  }
  // Meta: messageOrId é o media_id string
  return await meta.downloadMediaToBuffer(messageOrId);
}

// ─── Transcode (provider-agnostic — sempre usa ffmpeg) ───
const { transcodeAudio } = require('./whatsapp-meta');

// ─── Notificações (sempre via Meta sendMessage genérico) ───
// Funções de notificação chamam sendMessage internamente, então
// automaticamente passam pelo provider ativo.
async function notifyOwner(leadPhone, apptData) {
  return await meta.notifyOwner.call({ sendMessage }, leadPhone, apptData);
}
// Hmm — meta.notifyOwner usa o sendMessage interno do Meta. Pra não duplicar
// a lógica das notificações, exporto reusando o sendMessage do facade:
async function _wrappedSendMessage(to, text) { return sendMessage(to, text); }

// Re-exporto as funções de notificação do whatsapp-meta mas elas
// chamam sendMessage diretamente (não o do facade). Pra simplificar,
// vou copiar a lógica aqui ou deixar o whatsapp-meta usar facade...
// SOLUÇÃO: whatsapp-meta exporta as funções com sendFn injetável.
// Mas pra não complicar agora, exporto diretamente — Meta sempre será
// usado pra notify (já que o owner phone é fixo, e notify é msg de
// serviço que pode ser oficial mesmo se inbound for Baileys).
// Caveat: se PROVIDER=baileys, notify também passa por Baileys porque
// Meta não vai ter mais credencial válida. Vamos delegar pro facade.

// Versão correta: notify functions importadas, mas que usam facade.
async function notifyOwner_v2(leadPhone, apptData) {
  const ownerPhone = process.env.OWNER_PHONE_NUMBER;
  if (!ownerPhone) {
    console.log('[whatsapp] OWNER_PHONE_NUMBER não configurado, pulando notificação');
    return;
  }
  const display = formatBRPhoneDisplay(leadPhone);
  const name       = apptData.nome       || 'Não informado';
  const day        = apptData.dia        || '—';
  const hour       = apptData.hora       || apptData.turno || '—';
  const modality   = apptData.modalidade || '—';
  const when = apptData.hora ? `${day} às ${hour}` : `${day} — ${hour}`;
  const message =
    `🎯 *Novo agendamento STRONIX*\n\n` +
    `👤 Nome: ${name}\n` +
    `📱 Telefone: ${display}\n` +
    `📅 Quando: ${when}\n` +
    `🏋️ Modalidade: ${modality}\n\n` +
    `Confirme com o lead e marque na agenda.\n\n` +
    `Ver conversa: https://stronix-sdr-production.up.railway.app/admin`;
  try {
    await sendMessage(ownerPhone, message);
    console.log(`[whatsapp] notificação de agendamento enviada para ${ownerPhone}`);
  } catch (err) {
    console.error('[whatsapp] erro ao notificar dono:', err.message);
  }
}

async function notifyStudent(studentPhone, student, incomingText) {
  const ownerPhone = process.env.OWNER_PHONE_NUMBER;
  if (!ownerPhone) return;
  const display = formatBRPhoneDisplay(studentPhone);
  const name    = student.name || 'Aluno (sem nome cadastrado)';
  const preview = incomingText.length > 200 ? incomingText.slice(0, 200) + '...' : incomingText;
  const message =
    `🎓 *Mensagem de aluno*\n\n` +
    `👤 ${name}\n` +
    `📱 ${display}\n\n` +
    `💬 _"${preview}"_\n\n` +
    `IA respondeu padrão e parou. Responde tu direto pelo WhatsApp.`;
  try {
    await sendMessage(ownerPhone, message);
  } catch (err) {
    console.error('[whatsapp] erro ao notificar dono sobre aluno:', err.message);
  }
}

async function notifyAssignedConsultor({ leadPhone, assignedUser, fallbackUsers, incomingText }) {
  const display = formatBRPhoneDisplay(leadPhone);
  const preview = incomingText.length > 200 ? incomingText.slice(0, 200) + '...' : incomingText;
  const targets = [];
  if (assignedUser && assignedUser.phone) {
    targets.push({ phone: assignedUser.phone, name: assignedUser.display_name });
  } else if (Array.isArray(fallbackUsers)) {
    for (const u of fallbackUsers) {
      if (u.phone) targets.push({ phone: u.phone, name: u.display_name });
    }
  }
  if (!targets.length) return;
  const headerLine = assignedUser
    ? `📩 *Nova mensagem do lead que você assumiu*`
    : `📩 *Nova mensagem de lead em atendimento humano (ainda sem dono)*`;
  const message =
    `${headerLine}\n\n` +
    `📱 ${display}\n\n` +
    `💬 _"${preview}"_\n\n` +
    `Acesse o painel pra responder: https://stronix-sdr-production.up.railway.app/admin`;
  for (const t of targets) {
    try { await sendMessage(t.phone, message); }
    catch (err) { console.error(`[whatsapp] erro ao notificar ${t.name}:`, err.message); }
  }
}

function formatBRPhoneDisplay(phone) {
  const n = phone.replace(/\D/g, '');
  if (n.startsWith('55') && n.length === 13) {
    return `(${n.slice(2, 4)}) ${n.slice(4, 9)}-${n.slice(9)}`;
  }
  return phone;
}

// Status / config queries
function getProvider() { return PROVIDER; }
function getBaileys()  { return baileys; }

module.exports = {
  PROVIDER,
  getProvider,
  getBaileys,
  sendMessage,
  sendVoice,
  transcodeAudio,
  downloadMediaBuffer,
  notifyOwner: notifyOwner_v2,
  notifyStudent,
  notifyAssignedConsultor,
  formatBRPhoneDisplay,
  // Compat: alguns chamadores usam sendAudio com mediaId (Meta-only)
  // Mantém disponível pra Meta pre-existente; Baileys callers devem usar sendVoice.
  sendAudio: meta.sendAudio,
  uploadMedia: meta.uploadMedia,
};
