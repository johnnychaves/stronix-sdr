const { Router } = require('express');
const config    = require('./config');
const { reply, isAffirmative, isNegative, getContact } = require('./agent');
const { sendMessage, sendAudio } = require('./whatsapp');
const { transcribeAudio } = require('./transcriber');
const { textToAudioMessage } = require('./tts');

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
  let isAudio = false;

  if (message.type === 'text') {
    text = message.text.body;
    console.log(`[webhook] texto de ${from}: "${text}"`);

  } else if (message.type === 'audio') {
    isAudio = true;
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
    const contact = getContact(from);

    // Lead estava respondendo ao pedido de permissão de áudio
    if (contact.awaitingAudioConfirm) {
      if (isAffirmative(text)) {
        contact.awaitingAudioConfirm = false;
        contact.audioPermission = true;
        console.log(`[webhook] ${from} autorizou áudio — próximas respostas podem ser em áudio`);
        // Processa normalmente com permissão de áudio ativa
      } else if (isNegative(text)) {
        contact.awaitingAudioConfirm = false;
        console.log(`[webhook] ${from} recusou áudio — continuando em texto`);
        // Processa normalmente sem áudio
      } else {
        // Resposta não relacionada — cancela a espera e processa normalmente
        contact.awaitingAudioConfirm = false;
      }
    }

    const result = await reply(from, text, { isAudio });

    if (result.useAudio) {
      // SDR decidiu responder em áudio
      console.log(`[webhook] enviando resposta em áudio para ${from}`);
      try {
        const mediaId = await textToAudioMessage(result.text);
        await sendAudio(from, mediaId);
      } catch (err) {
        console.error('[webhook] erro ao gerar/enviar áudio, enviando como texto:', err.message);
        await sendMessage(from, result.text);
      }
    } else {
      await sendMessage(from, result.text);
    }

  } catch (err) {
    console.error('[webhook] erro ao processar mensagem:', err.message);
  }
});

module.exports = router;
