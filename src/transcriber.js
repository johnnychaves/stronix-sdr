const axios = require('axios');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config({ override: true });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function transcribeAudio(mediaId) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  // 1. Busca a URL real do arquivo de mídia na API do Meta
  const mediaRes = await axios.get(
    `https://graph.facebook.com/v19.0/${mediaId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const mediaUrl = mediaRes.data.url;
  const mimeType = mediaRes.data.mime_type || '';

  // 2. Baixa o arquivo de áudio
  const audioRes = await axios.get(mediaUrl, {
    headers: { Authorization: `Bearer ${token}` },
    responseType: 'arraybuffer',
  });

  // 3. Salva em arquivo temporário
  // WhatsApp envia áudios como ogg/opus ou mp4
  const ext = mimeType.includes('ogg') ? '.ogg' : '.mp4';
  const tmpFile = path.join(os.tmpdir(), `wa_audio_${Date.now()}${ext}`);
  fs.writeFileSync(tmpFile, Buffer.from(audioRes.data));

  // 4. Transcreve com Whisper
  let transcript;
  try {
    const result = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: 'whisper-1',
      language: 'pt',
    });
    transcript = result.text;
  } finally {
    // 5. Remove o arquivo temporário independente do resultado
    fs.unlink(tmpFile, () => {});
  }

  return transcript;
}

module.exports = { transcribeAudio };
