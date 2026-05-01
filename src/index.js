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
});
