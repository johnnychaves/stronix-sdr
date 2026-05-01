const { Router } = require('express');
const config    = require('./config');
const { reply, isAffirmative, isNegative, getContact, setAudioFlags } = require('./agent');
const { sendMessage, sendAudio, notifyStudent, notifyAssignedConsultor } = require('./whatsapp');
const { transcribeAudio } = require('./transcriber');
const { textToAudioMessage } = require('./tts');
const db = require('./db');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Delay antes de enviar resposta de texto, simulando SDR humano que está
// atendendo várias conversas em paralelo. Range 1-3 min, proporcional ao
// tamanho — resposta curta ~60s, média ~120s, longa (300+ chars) ~180s.
function typingDelayMs(text) {
  const MIN_MS = 60 * 1000;   // 1 min — resposta curta
  const MAX_MS = 180 * 1000;  // 3 min — resposta longa
  const FULL_LEN = 300;       // chars que justificam o teto
  const ratio = Math.min(1, (text || '').length / FULL_LEN);
  return Math.round(MIN_MS + (MAX_MS - MIN_MS) * ratio);
}

// ─────────────────────────────────────────────────────────────────────
// BUFFER DE MENSAGENS (debouncing por phone)
//
// Lead/aluno costuma fragmentar pensamento em várias mensagens curtas
// ("oi" → "tem aula?" → "qual valor?"). Sem buffer, cada uma vira webhook
// independente, IA processa 3x e responde fora de ordem (especialmente
// com delay de 1-3 min entre processamento e envio).
//
// Solução: acumula msgs do mesmo phone numa janela de 15s sem nova msg.
// Quando timer expira, processa o batch concatenado como UMA conversa.
// ─────────────────────────────────────────────────────────────────────

const BUFFER_WINDOW_MS = 15 * 1000;
const buffers = new Map(); // phone -> { messages: [{text, isAudio}], timer }

function enqueueMessage(from, text, isAudio) {
  let buf = buffers.get(from);
  if (!buf) {
    buf = { messages: [], timer: null };
    buffers.set(from, buf);
  }
  buf.messages.push({ text, isAudio });
  if (buf.timer) clearTimeout(buf.timer);
  buf.timer = setTimeout(() => flushBuffer(from), BUFFER_WINDOW_MS);
  console.log(`[buffer] ${from} acumulou ${buf.messages.length} msg(s) — aguardando ${BUFFER_WINDOW_MS / 1000}s sem nova msg pra processar`);
}

function flushBuffer(from) {
  const buf = buffers.get(from);
  if (!buf || !buf.messages.length) {
    buffers.delete(from);
    return;
  }
  buffers.delete(from);

  const messages = buf.messages;
  const text       = messages.map(m => m.text).join('\n');
  const anyAudio   = messages.some(m => m.isAudio);
  const firstText  = messages.find(m => !m.isAudio)?.text || '';
  const explicitAudio = !anyAudio && messages.some(m => isExplicitAudioRequest(m.text));

  console.log(`[buffer] flush ${from}: ${messages.length} msg(s) concatenadas (${text.length} chars)`);

  processBatch(from, { text, anyAudio, explicitAudio, firstText }).catch(err => {
    console.error(`[buffer] erro ao processar batch de ${from}:`, err.message);
  });
}

async function processBatch(from, { text, anyAudio, explicitAudio, firstText }) {
  // Roteamento aluno vs lead — antes de qualquer IA
  const student = db.getStudent(from);
  if (student) {
    const firstName = student.name ? student.name.split(/\s*\/\s*/)[0].split(/\s+/)[0] : '';
    const greet = firstName ? `Oi ${firstName}!` : 'Oi!';
    const studentReply = `${greet} Aqui é o assistente da academia, mas pra coisas de aluno eu te passo direto pra equipe. Já avisei eles e logo te respondem 👋`;
    console.log(`[webhook] phone ${from} é aluno cadastrado (${student.name || 'sem nome'}) — desviando IA`);
    await sleep(typingDelayMs(studentReply));
    await sendMessage(from, studentReply);
    await notifyStudent(from, student, text);
    return;
  }

  // Handoff humano: se uma consultora/admin assumiu essa conversa, IA NÃO responde.
  // Salva a msg do lead no histórico (não chama Claude) e notifica a consultora.
  const assignment = db.getContactAssignment(from);
  if (assignment && assignment.humanAssumedAt) {
    db.getOrCreateContact(from);
    db.addMessageWithSender(from, 'user', text, anyAudio, null);
    db.updateLastContact(from);
    const assignedUser = assignment.assignedUserId ? db.getUserById(assignment.assignedUserId) : null;
    const fallbackUsers = assignedUser ? [] : [...db.getActiveAdmins(), ...db.getActiveConsultors()];
    console.log(`[webhook] ${from} em atendimento humano (${assignedUser?.display_name || 'sem dono'}) — IA não responde`);
    await notifyAssignedConsultor({
      leadPhone: from,
      assignedUser,
      fallbackUsers,
      incomingText: text,
    });
    return;
  }

  const contact = getContact(from);
  let forceAudio = false;

  if (anyAudio) {
    forceAudio = true;
    console.log(`[webhook] alguma msg do batch foi áudio → resposta forçada em áudio`);
  } else if (explicitAudio) {
    forceAudio = true;
    console.log(`[webhook] alguma msg pediu áudio explicitamente → resposta forçada em áudio`);
  } else if (contact.awaitingAudioConfirm) {
    if (isAffirmative(firstText)) {
      setAudioFlags(from, { awaitingAudioConfirm: false, audioPermission: true });
      forceAudio = true;
      console.log(`[webhook] lead confirmou áudio`);
    } else if (isNegative(firstText)) {
      setAudioFlags(from, { awaitingAudioConfirm: false });
      console.log(`[webhook] lead recusou áudio — continuando em texto`);
    } else {
      setAudioFlags(from, { awaitingAudioConfirm: false });
    }
  }

  const result = await reply(from, text, { isAudio: anyAudio, forceAudio });
  const shouldSendAudio = forceAudio || result.useAudio;

  if (shouldSendAudio) {
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

  // Acumula no buffer; processamento real (IA + envio) acontece quando o
  // timer do buffer expira (15s sem nova msg do mesmo phone).
  enqueueMessage(from, text, isAudio);
});

module.exports = router;
