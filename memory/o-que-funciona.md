# O Que Funciona — Soluções Validadas

Padrões, trechos de código e abordagens confirmadas em produção/testes. Reutilize antes de reinventar.

---

## 2026-04-30 — Normalização de número brasileiro para Meta API

**Contexto:** Ao responder mensagens recebidas via webhook, o campo `from` vem com 12 dígitos (sem o 9º dígito móvel). A API de envio exige 13 dígitos.

**Solução:** (`src/whatsapp.js`)
```js
function normalizeBRNumber(number) {
  if (number.startsWith('55') && number.length === 12) {
    return number.slice(0, 4) + '9' + number.slice(4);
  }
  return number;
}
```

**Por que funciona:** O Meta armazena o wa_id no formato antigo (8 dígitos após o DDD), mas a API de envio aceita apenas o formato atual com 9 dígitos. A função insere o `9` na posição correta (após país+DDD = 4 dígitos).

---

## 2026-04-30 — Formato de token no webhook Meta

**Contexto:** O Meta faz um GET no endpoint do webhook para verificação antes de aceitar a URL.

**Solução:** (`src/webhook.js`)
```js
router.get('/', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === config.webhook.verifyToken) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});
```
**Por que funciona:** O Meta envia `hub.challenge` e espera receber exatamente esse valor de volta com status 200.

---

## Estrutura de entrada esperada

```
## [Data] — [Nome curto da solução]

**Contexto:** onde e quando usar
**Solução:** o que faz / como funciona
**Código ou referência:** (trecho ou caminho do arquivo)
**Por que funciona:** aprendizado chave
```
