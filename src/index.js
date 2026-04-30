const express = require('express');
const config  = require('./config');
const webhook = require('./webhook');

const app = express();
app.use(express.json());

app.use('/webhook', webhook);

app.get('/', (_, res) => res.send('Agente WhatsApp rodando.'));

app.listen(config.port, () => {
  console.log(`[server] rodando na porta ${config.port}`);
  console.log(`[server] webhook em http://localhost:${config.port}/webhook`);
});
