require('dotenv').config({ override: true });

const PROVIDER = (process.env.WHATSAPP_PROVIDER || 'meta').toLowerCase();

// Vars obrigatórias só quando o provider é Meta Cloud API.
// Quando WHATSAPP_PROVIDER=baileys, não precisa de credencial Meta.
const required = PROVIDER === 'baileys'
  ? []
  : ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WEBHOOK_VERIFY_TOKEN'];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Variável de ambiente obrigatória não definida: ${key}`);
  }
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('[config] ANTHROPIC_API_KEY não definida — Claude será integrado na Etapa 2');
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
