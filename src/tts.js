const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config({ override: true });

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID;

// Gera o áudio via ElevenLabs e salva em arquivo temporário
async function generateSpeech(text) {
  const response = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
    {
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.45,         // variação natural — não monótono
        similarity_boost: 0.90,  // fiel à voz clonada
        style: 0.35,             // leve expressividade
        use_speaker_boost: true, // reforça a identidade da voz
      },
    },
    {
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      responseType: 'arraybuffer',
    }
  );

  const tmpFile = path.join(os.tmpdir(), `tts_${Date.now()}.mp3`);
  fs.writeFileSync(tmpFile, Buffer.from(response.data));
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

// Pipeline completo: texto → ElevenLabs → upload Meta → media_id
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
