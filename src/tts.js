const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config({ override: true });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Instrução de voz — descreve o personagem para o gpt-4o-mini-tts
const VOICE_INSTRUCTIONS = `Você é o Johnny, um homem gaúcho de Porto Alegre, dono de uma academia chamada STRONIX. Sua voz é grave, calorosa e firme — mas tem energia, não é monótona.

Tom: confiante, descontraído, próximo. Como alguém gravando rapidamente um áudio no WhatsApp pra um cliente que ele realmente quer ajudar — sem papo de vendedor.

Ritmo: natural de conversa. Use pausas curtas onde faria sentido respirar. Não acelere demais nem fique lento e arrastado. Pense em alguém andando pela academia enquanto fala.

Sotaque: gaúcho leve, do sul do Brasil. Não exagerado. Pronúncia clara em português brasileiro.

Emoção: passe interesse genuíno. Quando contar algo bom, deixe transparecer. Quando perguntar, soe curioso de verdade. Evite tom comercial ou plástico.`;

// Gera o áudio e salva em arquivo temporário
async function generateSpeech(text) {
  const response = await openai.audio.speech.create({
    model: 'gpt-4o-mini-tts',
    voice: 'onyx', // voz grave masculina — base do personagem
    input: text,
    instructions: VOICE_INSTRUCTIONS,
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  const tmpFile = path.join(os.tmpdir(), `tts_${Date.now()}.mp3`);
  fs.writeFileSync(tmpFile, buffer);
  return tmpFile;
}

// Faz upload do áudio na API do Meta e retorna o media_id
async function uploadAudioToMeta(filePath) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer], { type: 'audio/mpeg' });

  const form = new FormData();
  form.append('file', blob, 'audio.mp3');
  form.append('type', 'audio/mpeg');
  form.append('messaging_product', 'whatsapp');

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${phoneNumberId}/media`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }
  );

  const data = await res.json();
  if (!data.id) throw new Error(`Upload de áudio falhou: ${JSON.stringify(data)}`);
  return data.id;
}

// Pipeline completo: texto → áudio → upload → media_id
async function textToAudioMessage(text) {
  const filePath = await generateSpeech(text);
  try {
    const mediaId = await uploadAudioToMeta(filePath);
    return mediaId;
  } finally {
    fs.unlink(filePath, () => {});
  }
}

module.exports = { textToAudioMessage };
