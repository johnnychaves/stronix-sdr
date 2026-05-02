const axios = require('axios');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config({ override: true });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Transcreve um Buffer de áudio (qualquer formato suportado pelo Whisper).
// Provider-agnostic: funciona pra Meta (após download) e Baileys (após decrypt).
async function transcribeAudioBuffer(buffer, mimeType) {
  // Whisper aceita ogg, mp3, m4a, wav, webm. Detecta extensão pelo mime.
  const ext = (() => {
    const m = (mimeType || '').toLowerCase();
    if (m.includes('ogg')) return '.ogg';
    if (m.includes('mp4') || m.includes('m4a')) return '.m4a';
    if (m.includes('mpeg') || m.includes('mp3')) return '.mp3';
    if (m.includes('webm')) return '.webm';
    if (m.includes('wav')) return '.wav';
    return '.ogg'; // default seguro
  })();

  const tmpFile = path.join(os.tmpdir(), `wa_audio_${Date.now()}${ext}`);
  fs.writeFileSync(tmpFile, buffer);

  try {
    const result = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: 'whisper-1',
      language: 'pt',
    });
    return result.text;
  } finally {
    fs.unlink(tmpFile, () => {});
  }
}

// Compat: transcreve a partir de um Meta media_id (legacy path).
// Quando WHATSAPP_PROVIDER=meta, ainda é chamado por algum código antigo.
async function transcribeAudio(mediaId) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const mediaRes = await axios.get(
    `https://graph.facebook.com/v19.0/${mediaId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const audioRes = await axios.get(mediaRes.data.url, {
    headers: { Authorization: `Bearer ${token}` },
    responseType: 'arraybuffer',
  });
  return await transcribeAudioBuffer(Buffer.from(audioRes.data), mediaRes.data.mime_type || '');
}

module.exports = { transcribeAudio, transcribeAudioBuffer };
