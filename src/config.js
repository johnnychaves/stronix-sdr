require('dotenv').config();

const required = [
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_ACCESS_TOKEN',
  'WEBHOOK_VERIFY_TOKEN',
  'ANTHROPIC_API_KEY',
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Variável de ambiente obrigatória não definida: ${key}`);
  }
}

module.exports = {
  whatsapp: {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken:   process.env.WHATSAPP_ACCESS_TOKEN,
    apiVersion:    'v19.0',
  },
  webhook: {
    verifyToken: process.env.WEBHOOK_VERIFY_TOKEN,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
  port: process.env.PORT || 3000,
};
