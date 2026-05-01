const axios = require('axios');
const { spawn } = require('child_process');
const config = require('./config');

const BASE_URL = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;

// O Meta retorna wa_id sem o 9º dígito em números BR (12 dígitos → 13)
function normalizeBRNumber(number) {
  if (number.startsWith('55') && number.length === 12) {
    return number.slice(0, 4) + '9' + number.slice(4);
  }
  return number;
}

async function sendMessage(to, text) {
  const recipient = normalizeBRNumber(to);
  await axios.post(
    BASE_URL,
    {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'text',
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${config.whatsapp.accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

async function sendAudio(to, mediaId) {
  const recipient = normalizeBRNumber(to);
  await axios.post(
    BASE_URL,
    {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'audio',
      audio: { id: mediaId },
    },
    {
      headers: {
        Authorization: `Bearer ${config.whatsapp.accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

// Faz upload de mídia (áudio/imagem/etc) pra Meta Cloud API e retorna media_id.
// Buffer = conteúdo binário; mimeType ex: 'audio/ogg', 'audio/mpeg', 'audio/mp4'.
async function uploadMedia(buffer, mimeType, filename = 'upload.bin') {
  const url = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/media`;
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', new Blob([buffer], { type: mimeType }), filename);
  const res = await axios.post(url, form, {
    headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` },
    maxBodyLength: 32 * 1024 * 1024,
    maxContentLength: 32 * 1024 * 1024,
  });
  return res.data.id;
}

// Remuxa container de áudio via ffmpeg, mantendo o codec quando possível
// (webm/opus → ogg/opus é -c:a copy, instantâneo). Pra outros formatos faz
// re-encode pra opus 64kbps.
// Necessário porque Chrome grava só em webm e WhatsApp Cloud API não aceita
// webm — exige ogg/opus, mp4, mp3, aac ou amr.
function transcodeAudio(inputBuffer, inputMime) {
  return new Promise((resolve, reject) => {
    const isOpusContainer = inputMime === 'audio/webm' || inputMime === 'audio/ogg';
    const args = ['-loglevel', 'error', '-i', 'pipe:0'];
    if (isOpusContainer) {
      // Mesmo codec opus, só troca container — sem re-encode
      args.push('-c:a', 'copy');
    } else {
      // Re-encode pra opus 64kbps (qualidade voz)
      args.push('-c:a', 'libopus', '-b:a', '64k');
    }
    args.push('-f', 'ogg', 'pipe:1');

    let ff;
    try {
      ff = spawn('ffmpeg', args);
    } catch (e) {
      return reject(new Error('ffmpeg não instalado: ' + e.message));
    }

    const out = [];
    const errLog = [];
    ff.stdout.on('data', d => out.push(d));
    ff.stderr.on('data', d => errLog.push(d));
    ff.on('error', err => reject(new Error('ffmpeg spawn falhou: ' + err.message)));
    ff.on('close', code => {
      if (code === 0) {
        resolve(Buffer.concat(out));
      } else {
        const log = Buffer.concat(errLog).toString('utf8').slice(0, 500);
        reject(new Error(`ffmpeg exit ${code}: ${log}`));
      }
    });
    ff.stdin.on('error', err => reject(new Error('ffmpeg stdin: ' + err.message)));
    ff.stdin.write(inputBuffer);
    ff.stdin.end();
  });
}

// Formata número BR pra exibição: 5551995304633 → (51) 99530-4633
function formatBRPhoneDisplay(phone) {
  const n = phone.replace(/\D/g, '');
  if (n.startsWith('55') && n.length === 13) {
    return `(${n.slice(2, 4)}) ${n.slice(4, 9)}-${n.slice(9)}`;
  }
  return phone;
}

// Envia notificação de agendamento pro dono da academia
async function notifyOwner(leadPhone, apptData) {
  const ownerPhone = process.env.OWNER_PHONE_NUMBER;
  if (!ownerPhone) {
    console.log('[whatsapp] OWNER_PHONE_NUMBER não configurado, pulando notificação');
    return;
  }

  const name       = apptData.nome       || 'Não informado';
  const day        = apptData.dia        || '—';
  const hour       = apptData.hora       || apptData.turno || '—';
  const modality   = apptData.modalidade || '—';
  const display    = formatBRPhoneDisplay(leadPhone);

  // "terça às 9h" ou fallback "terça — manhã" se só tiver turno
  const when = apptData.hora
    ? `${day} às ${hour}`
    : `${day} — ${hour}`;

  const message =
    `🎯 *Novo agendamento STRONIX*\n\n` +
    `👤 Nome: ${name}\n` +
    `📱 Telefone: ${display}\n` +
    `📅 Quando: ${when}\n` +
    `🏋️ Modalidade: ${modality}\n\n` +
    `Confirme com o lead e marque na agenda.\n\n` +
    `Ver conversa: https://stronix-sdr-production.up.railway.app/admin`;

  try {
    await sendMessage(ownerPhone, message);
    console.log(`[whatsapp] notificação de agendamento enviada para ${ownerPhone}`);
  } catch (err) {
    console.error('[whatsapp] erro ao notificar dono:', err.message);
  }
}

// Notifica dono quando aluno (não lead) manda mensagem
async function notifyStudent(studentPhone, student, incomingText) {
  const ownerPhone = process.env.OWNER_PHONE_NUMBER;
  if (!ownerPhone) {
    console.log('[whatsapp] OWNER_PHONE_NUMBER não configurado, pulando notificação de aluno');
    return;
  }

  const display = formatBRPhoneDisplay(studentPhone);
  const name    = student.name || 'Aluno (sem nome cadastrado)';
  const preview = incomingText.length > 200 ? incomingText.slice(0, 200) + '...' : incomingText;

  const message =
    `🎓 *Mensagem de aluno*\n\n` +
    `👤 ${name}\n` +
    `📱 ${display}\n\n` +
    `💬 _"${preview}"_\n\n` +
    `IA respondeu padrão e parou. Responde tu direto pelo WhatsApp.`;

  try {
    await sendMessage(ownerPhone, message);
    console.log(`[whatsapp] notificação de aluno enviada pra ${ownerPhone}`);
  } catch (err) {
    console.error('[whatsapp] erro ao notificar dono sobre aluno:', err.message);
  }
}

// Notifica consultora atribuída (ou todos os admins se ainda não atribuída) que
// um lead enviou mensagem enquanto o atendimento humano está ativo.
async function notifyAssignedConsultor({ leadPhone, assignedUser, fallbackUsers, incomingText }) {
  const display = formatBRPhoneDisplay(leadPhone);
  const preview = incomingText.length > 200 ? incomingText.slice(0, 200) + '...' : incomingText;

  // Lista de destinos: a consultora atribuída (se tem phone) OU os admins/consultoras de fallback
  const targets = [];
  if (assignedUser && assignedUser.phone) {
    targets.push({ phone: assignedUser.phone, name: assignedUser.display_name });
  } else if (Array.isArray(fallbackUsers)) {
    for (const u of fallbackUsers) {
      if (u.phone) targets.push({ phone: u.phone, name: u.display_name });
    }
  }

  if (!targets.length) {
    console.log('[whatsapp] notifyAssignedConsultor: sem destinos com phone cadastrado, pulando');
    return;
  }

  const headerLine = assignedUser
    ? `📩 *Nova mensagem do lead que você assumiu*`
    : `📩 *Nova mensagem de lead em atendimento humano (ainda sem dono)*`;

  const message =
    `${headerLine}\n\n` +
    `📱 ${display}\n\n` +
    `💬 _"${preview}"_\n\n` +
    `Acesse o painel pra responder: https://stronix-sdr-production.up.railway.app/admin`;

  for (const t of targets) {
    try {
      await sendMessage(t.phone, message);
      console.log(`[whatsapp] notificação de mensagem humana enviada pra ${t.name} (${t.phone})`);
    } catch (err) {
      console.error(`[whatsapp] erro ao notificar ${t.name}:`, err.message);
    }
  }
}

module.exports = { sendMessage, sendAudio, uploadMedia, transcodeAudio, notifyOwner, notifyStudent, notifyAssignedConsultor };
