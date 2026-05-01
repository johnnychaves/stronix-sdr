const express = require('express');
const config  = require('./config');
const webhook = require('./webhook');
const admin   = require('./admin');

const app = express();
// 1MB cobre import bulk de ~10k clientes — default 100KB era apertado
app.use(express.json({ limit: '1mb' }));

app.use('/webhook', webhook);
app.use('/admin', admin);

app.get('/', (_, res) => res.send('Agente WhatsApp rodando.'));

app.listen(config.port, () => {
  console.log(`[server] rodando na porta ${config.port}`);
  console.log(`[server] webhook em http://localhost:${config.port}/webhook`);
  console.log(`[server] painel admin em http://localhost:${config.port}/admin`);
});
