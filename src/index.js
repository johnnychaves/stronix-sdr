const express = require('express');
const config  = require('./config');
const webhook = require('./webhook');
const admin   = require('./admin');

const app = express();
// 25MB pra suportar áudio enviado pelo painel (WhatsApp aceita até 16MB,
// + overhead de ~33% do base64). 1MB era o anterior, default Express é 100KB.
app.use(express.json({ limit: '25mb' }));

app.use('/webhook', webhook);
app.use('/admin', admin);

app.get('/', (_, res) => res.send('Agente WhatsApp rodando.'));

app.listen(config.port, () => {
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
});
