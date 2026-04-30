const { Router } = require('express');
const config    = require('./config');
const { reply } = require('./agent');
const { sendMessage } = require('./whatsapp');

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

  if (!message || message.type !== 'text') return;

  const from = message.from;
  const text = message.text.body;

  console.log(`[webhook] mensagem recebida de ${from}: "${text}"`);

  try {
    const response = await reply(from, text);
    await sendMessage(from, response);
  } catch (err) {
    console.error('[webhook] erro ao processar mensagem:', err.message);
  }
});

module.exports = router;
