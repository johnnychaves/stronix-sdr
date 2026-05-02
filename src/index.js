const express = require('express');
const config  = require('./config');
const webhook = require('./webhook');
const admin   = require('./admin');
const wa      = require('./whatsapp');

const app = express();
// 25MB pra suportar áudio enviado pelo painel (WhatsApp aceita até 16MB,
// + overhead de ~33% do base64). 1MB era o anterior, default Express é 100KB.
app.use(express.json({ limit: '25mb' }));

app.use('/webhook', webhook);
app.use('/admin', admin);

app.get('/', (_, res) => res.send('Agente WhatsApp rodando.'));

app.listen(config.port, async () => {
  console.log(`[server] rodando na porta ${config.port}`);
  console.log(`[server] webhook em http://localhost:${config.port}/webhook`);
  console.log(`[server] painel admin em http://localhost:${config.port}/admin`);

  // Health check do ffmpeg (necessário pro envio de áudio pelo painel)
  const { spawn } = require('child_process');
  try {
    const ff = spawn('ffmpeg', ['-version']);
    let firstLine = '';
    ff.stdout.on('data', d => { if (!firstLine) firstLine = d.toString().split('\n')[0]; });
    ff.on('error', err => {
      console.warn('[server] ⚠️  ffmpeg NÃO encontrado no PATH:', err.message);
      console.warn('[server] envio de áudio pelo painel NÃO vai funcionar sem ffmpeg.');
    });
    ff.on('close', code => {
      if (code === 0 && firstLine) {
        console.log('[server] ✓ ffmpeg disponível:', firstLine);
      }
    });
  } catch (e) {
    console.warn('[server] ⚠️  Falha ao testar ffmpeg:', e.message);
  }

  // ─── Baileys bootstrap ───
  // Quando WHATSAPP_PROVIDER=baileys, conecta no WhatsApp via QR e registra
  // o handler de mensagens entrantes.
  if (wa.PROVIDER === 'baileys') {
    try {
      const baileys = wa.getBaileys();
      const { handleIncomingMessage } = webhook;

      baileys.setMessageHandler(async (msg, sock) => {
        // Usa extractor robusto que trata LID (privacy mode WhatsApp Multi-Device)
        const from = baileys.extractPhoneFromKey(msg.key);
        const body = baileys.extractMessageBody(msg);
        if (body.type === 'text') {
          console.log(`[baileys] texto de ${from}: "${body.text}"`);
          await handleIncomingMessage({ from, type: 'text', text: body.text });
        } else if (body.type === 'audio') {
          console.log(`[baileys] áudio recebido de ${from}, baixando + transcrevendo...`);
          try {
            const buffer = await baileys.downloadMedia(msg);
            const mime = body.audioMessage?.mimetype || 'audio/ogg';
            await handleIncomingMessage({ from, type: 'audio', audioBuffer: buffer, audioMime: mime });
          } catch (err) {
            console.error('[baileys] erro ao baixar áudio:', err.message);
          }
        } else {
          console.log(`[baileys] tipo não suportado de ${from}: ${body.type}`);
        }
      });

      await baileys.start();
    } catch (e) {
      console.error('[server] erro ao iniciar Baileys:', e.message);
    }
  }
});
