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

module.exports = { sendMessage, sendAudio };
