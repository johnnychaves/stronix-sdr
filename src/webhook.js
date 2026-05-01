const { Router } = require('express');
const config    = require('./config');
const { reply, isAffirmative, isNegative, getContact, setAudioFlags } = require('./agent');
const { sendMessage, sendAudio, notifyStudent } = require('./whatsapp');
const { transcribeAudio } = require('./transcriber');
const { textToAudioMessage } = require('./tts');
const db = require('./db');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Delay simulando digitação humana antes de enviar resposta de texto.
// 25ms/char ≈ 40 chars/s (digitação ágil). Mín 1s, máx 3s.
function typingDelayMs(text) {
  return Math.min(3000, Math.max(1000, text.length * 25));
}

// Detecta quando o lead pede explicitamente áudio por texto
function isExplicitAudioRequest(text) {
  return /(fala|manda|pode mandar|responde?|me manda|prefiro|quero|me fala).{0,20}(áudio|audio|voz)/i.test(text)
    || /^(áudio|audio|por áudio|em áudio|via áudio|no áudio)/i.test(text.trim())
    || /^(manda|fala|pode).{0,10}(áudio|audio)/i.test(text.trim());
}

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
    // Roteamento aluno vs lead — antes de qualquer IA
    // Se o phone está cadastrado em students, IA NÃO roda. Resposta padrão + notifica dono.
    const student = db.getStudent(from);
    if (student) {
      const firstName = student.name ? student.name.split(/\s+/)[0] : '';
      const greet = firstName ? `Oi ${firstName}!` : 'Oi!';
      const studentReply = `${greet} Aqui é o assistente da academia, mas pra coisas de aluno eu te passo direto pra equipe. Já avisei eles e logo te respondem 👋`;
      console.log(`[webhook] phone ${from} é aluno cadastrado (${student.name || 'sem nome'}) — desviando IA`);
      await sleep(typingDelayMs(studentReply));
      await sendMessage(from, studentReply);
      await notifyStudent(from, student, text);
      return;
    }

    const contact = getContact(from);

    // Determina se o código deve forçar resposta em áudio
    // (independente do que o Claude decidir)
    let forceAudio = false;

    if (isAudio) {
      // Lead mandou áudio → espelha o meio, sempre
      forceAudio = true;
      console.log(`[webhook] lead mandou áudio → resposta forçada em áudio`);
    } else if (isExplicitAudioRequest(text)) {
      // Lead pediu áudio explicitamente em texto → atende
      forceAudio = true;
      console.log(`[webhook] lead pediu áudio explicitamente → resposta forçada em áudio`);
    } else if (contact.awaitingAudioConfirm) {
      // Lead estava respondendo ao pedido de permissão de áudio
      if (isAffirmative(text)) {
        setAudioFlags(from, { awaitingAudioConfirm: false, audioPermission: true });
        forceAudio = true;
        console.log(`[webhook] lead confirmou áudio`);
      } else if (isNegative(text)) {
        setAudioFlags(from, { awaitingAudioConfirm: false });
        console.log(`[webhook] lead recusou áudio — continuando em texto`);
      } else {
        setAudioFlags(from, { awaitingAudioConfirm: false });
      }
    }

    const result = await reply(from, text, { isAudio, forceAudio });

    // Envia como áudio se: código forçou OU Claude optou por áudio
    const shouldSendAudio = forceAudio || result.useAudio;

    if (shouldSendAudio) {
      // Áudio já tem latência natural do TTS (~2-3s) — não adiciona delay extra.
      console.log(`[webhook] enviando resposta em áudio para ${from}`);
      try {
        const mediaId = await textToAudioMessage(result.text);
        await sendAudio(from, mediaId);
      } catch (err) {
        console.error('[webhook] erro ao gerar/enviar áudio, enviando como texto:', err.message);
        await sleep(typingDelayMs(result.text));
        await sendMessage(from, result.text);
      }
    } else {
      await sleep(typingDelayMs(result.text));
      await sendMessage(from, result.text);
    }

  } catch (err) {
    console.error('[webhook] erro ao processar mensagem:', err.message);
  }
});

module.exports = router;
