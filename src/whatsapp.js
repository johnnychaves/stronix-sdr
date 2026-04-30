const axios = require('axios');
const config = require('./config');

const BASE_URL = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;

async function sendMessage(to, text) {
  await axios.post(
    BASE_URL,
    {
      messaging_product: 'whatsapp',
      to,
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

module.exports = { sendMessage };
