const axios = require('axios');
const config = require('./config');

const BASE_URL = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;

// O Meta retorna wa_id sem o 9º dígito em números BR (12 dígitos → 13)
function normalizeBRNumber(number) {
  if (number.startsWith('55') && number.length === 12) {
    return number.slice(0, 4) + '9' + number.slice(4);
  }
  return number;
}

async function sendMessage(to, text) {
  const recipient = normalizeBRNumber(to);
  await axios.post(
    BASE_URL,
    {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'text',
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${config.whatsapp.accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

async function sendAudio(to, mediaId) {
  const recipient = normalizeBRNumber(to);
  await axios.post(
    BASE_URL,
    {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'audio',
      audio: { id: mediaId },
    },
    {
      headers: {
        Authorization: `Bearer ${config.whatsapp.accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

// Formata número BR pra exibição: 5551995304633 → (51) 99530-4633
function formatBRPhoneDisplay(phone) {
  const n = phone.replace(/\D/g, '');
  if (n.startsWith('55') && n.length === 13) {
    return `(${n.slice(2, 4)}) ${n.slice(4, 9)}-${n.slice(9)}`;
  }
  return phone;
}

// Envia notificação de agendamento pro dono da academia
async function notifyOwner(leadPhone, apptData) {
  const ownerPhone = process.env.OWNER_PHONE_NUMBER;
  if (!ownerPhone) {
    console.log('[whatsapp] OWNER_PHONE_NUMBER não configurado, pulando notificação');
    return;
  }

  const name       = apptData.nome       || 'Não informado';
  const day        = apptData.dia        || '—';
  const hour       = apptData.hora       || apptData.turno || '—';
  const modality   = apptData.modalidade || '—';
  const display    = formatBRPhoneDisplay(leadPhone);

  // "terça às 9h" ou fallback "terça — manhã" se só tiver turno
  const when = apptData.hora
    ? `${day} às ${hour}`
    : `${day} — ${hour}`;

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

// Notifica dono quando aluno (não lead) manda mensagem
async function notifyStudent(studentPhone, student, incomingText) {
  const ownerPhone = process.env.OWNER_PHONE_NUMBER;
  if (!ownerPhone) {
    console.log('[whatsapp] OWNER_PHONE_NUMBER não configurado, pulando notificação de aluno');
    return;
  }

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
    console.log(`[whatsapp] notificação de aluno enviada pra ${ownerPhone}`);
  } catch (err) {
    console.error('[whatsapp] erro ao notificar dono sobre aluno:', err.message);
  }
}

module.exports = { sendMessage, sendAudio, notifyOwner, notifyStudent };
