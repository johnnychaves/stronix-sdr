const { Router } = require('express');
const config    = require('./config');
const { reply } = require('./agent');
const { sendMessage } = require('./whatsapp');
const { transcribeAudio } = require('./transcriber');

const router = Router();

// Verificação do webhook exigida pelo Meta ao cadastrar a URL
router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.webhook.verifyToken) {
    console.log('[webhook] verificado pelo Meta');
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

// Recebe mensagens enviadas ao número
router.post('/', async (req, res) => {
  res.sendStatus(200); // responde rápido para o Meta não reenviar

  const entry = req.body?.entry?.[0];
  const change = entry?.changes?.[0];
  const message = change?.value?.messages?.[0];

  if (!message) return;

  const from = message.from;
  let text;

  if (message.type === 'text') {
    text = message.text.body;
    console.log(`[webhook] texto de ${from}: "${text}"`);

  } else if (message.type === 'audio') {
    console.log(`[webhook] áudio recebido de ${from}, transcrevendo...`);
    try {
      text = await transcribeAudio(message.audio.id);
      console.log(`[webhook] transcrição de ${from}: "${text}"`);
    } catch (err) {
      console.error('[webhook] erro ao transcrever áudio:', err.message);
      await sendMessage(from, 'Recebi seu áudio, mas não consegui entender. Pode me mandar por texto?');
      return;
    }

    if (!text || !text.trim()) {
      await sendMessage(from, 'Não consegui entender o áudio. Pode repetir ou mandar por texto?');
      return;
    }

  } else {
    // Sticker, imagem, vídeo, localização, etc — ignora silenciosamente
    console.log(`[webhook] tipo não suportado ignorado: ${message.type}`);
    return;
  }

  try {
    const response = await reply(from, text);
    await sendMessage(from, response);
  } catch (err) {
    console.error('[webhook] erro ao processar mensagem:', err.message);
  }
});

module.exports = router;
