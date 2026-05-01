# O Que Funciona — Soluções Validadas

Padrões, trechos de código e abordagens confirmadas em produção/testes. Reutilize antes de reinventar.

---

## 2026-05-01 — Debounce por chave em Map<phone, {messages, timer}>

**Contexto:** Acumular mensagens fragmentadas do mesmo lead/aluno e processar em lote depois de janela de inatividade.

**Solução:** (`src/webhook.js`)
```js
const BUFFER_WINDOW_MS = 15 * 1000;
const buffers = new Map();

function enqueueMessage(from, text, isAudio) {
  let buf = buffers.get(from);
  if (!buf) {
    buf = { messages: [], timer: null };
    buffers.set(from, buf);
  }
  buf.messages.push({ text, isAudio });
  if (buf.timer) clearTimeout(buf.timer);
  buf.timer = setTimeout(() => flushBuffer(from), BUFFER_WINDOW_MS);
}

function flushBuffer(from) {
  const buf = buffers.get(from);
  if (!buf || !buf.messages.length) { buffers.delete(from); return; }
  buffers.delete(from);
  // ... processa buf.messages como batch
}
```

**Por que funciona:** Cada nova msg cancela o timer anterior e agenda um novo. Só dispara quando passa N segundos SEM nova msg do mesmo phone. Map permite múltiplos leads independentes em paralelo. State em memória — perdas em restart aceitáveis pra esse uso.

---

## 2026-05-01 — Auth + sessões em SQLite sem deps novas (scrypt + cookie manual)

**Contexto:** Adicionar login multi-usuário sem trazer bcrypt, jsonwebtoken, express-session, cookie-parser ou passport. Mantém footprint enxuto.

**Solução:**
```js
// Hash com scrypt do crypto built-in (Node 18+)
const crypto = require('crypto');
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}$${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split('$');
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'));
}
```

```js
// Parser de cookie manual (~10 linhas, sem cookie-parser)
function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const out = {};
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const k = pair.slice(0, idx).trim();
    out[k] = decodeURIComponent(pair.slice(idx + 1).trim());
  }
  return out;
}
```

```js
// Sessão = UUID + row em SQLite com expires_at
function createSession(userId, ttlMs) {
  const token = crypto.randomUUID();
  // INSERT INTO sessions (token, user_id, created_at, expires_at)
  return token;
}
function getSessionUser(token) {
  const row = stmt.getSessionByToken.get(token);
  if (!row || row.expires_at < Date.now() || !row.active) return null;
  return { id: row.u_id, username: row.username, ... };
}
```

**Por que funciona:**
- scrypt é resistente a brute-force (ASIC-hard) e timingSafeEqual neutraliza timing attacks
- Cookie httpOnly + sameSite=lax + secure-em-prod cobre XSS + CSRF + sniffing
- Sessão em DB permite logout server-side (vs JWT que precisa de blacklist) e expiração natural
- Zero deps novas → zero risco de cadeia de supply-chain

---

## 2026-05-01 — Bootstrap UI dinâmico em vez de senha-padrão

**Contexto:** Como criar o primeiro admin sem hardcodar senha (vergonhoso e inseguro) nem precisar rodar script CLI em produção.

**Solução:**
- Endpoint público `/api/auth/status` retorna `{ bootstrap: countAdmins() === 0 }`
- Tela de login JS lê isso e muda o form: bootstrap mostra campos extras (displayName + phone) e POSTa em `/api/auth/bootstrap`
- Endpoint bootstrap só funciona se NÃO existe admin ativo. Depois disso, retorna 403

**Por que funciona:**
- Zero senha hardcoded
- Zero variável de ambiente sensível
- Zero comando manual
- Self-service: 1ª pessoa que acessa cria o primeiro admin com a senha que quiser

---

## 2026-05-01 — Race protection em "assumir conversa" sem lock

**Contexto:** Pool aberto — múltiplas consultoras podem clicar "Assumir" quase simultâneo. Sem proteção, a 2ª clicada ganha (last write wins) e a 1ª acha que pegou.

**Solução:** UPDATE com WHERE da condição prévia + checagem de rows-affected.
```js
const result = stmt.assumeConversationStmt.run(userId, Date.now(), phone);
// stmt: UPDATE contacts SET assigned_user_id=?, human_assumed_at=? WHERE phone=? AND assigned_user_id IS NULL
return result.changes > 0; // true = pegou; false = outro pegou primeiro
```

**Por que funciona:** SQLite atomiza o UPDATE. WHERE assigned_user_id IS NULL impede sobrescrever assignment existente. Se 2 cliques simultâneos: o 1º faz changes=1, o 2º faz changes=0 e o frontend mostra "alguém já assumiu".

---

## 2026-05-01 — Bulk insert transacional com better-sqlite3

**Contexto:** Importar 594 registros via 594 PUTs separados é lento e martela o servidor. Bulk em transação única é ordens de grandeza mais rápido.

**Solução:** (`src/db.js`)
```js
function bulkUpsertStudents(items) {
  let inserted = 0, updated = 0, skipped = 0;
  const tx = db.transaction((items) => {
    const now = Date.now();
    for (const item of items) {
      const phone = String(item.phone || '').replace(/\D/g, '');
      if (phone.length < 10) { skipped++; continue; }
      const existed = !!stmts.getStudent.get(phone);
      stmts.upsertStudent.run(phone, item.name || null, item.notes || null, now);
      if (existed) updated++; else inserted++;
    }
  });
  tx(items);
  return { inserted, updated, skipped };
}
```

**Por que funciona:** `db.transaction()` do better-sqlite3 envolve em BEGIN/COMMIT automaticamente, com rollback em erro. Sem network round-trip por linha (é tudo in-process). 594 inserts em ~50ms.

---

## 2026-05-01 — Agrupar duplicatas em planilha externa antes de importar

**Contexto:** Planilha de clientes da STRONIX tinha 8 phones com 2 clientes ativos cada (famílias compartilhando número). Bulk simples sobrescreveria nomes silenciosamente.

**Solução:** (`scripts/import_students.py`)
```python
grouped = {}
for row in rows:
    phone = normalize(row.telefone)
    if phone not in grouped:
        grouped[phone] = {'names': [], 'contratos': []}
    grouped[phone]['names'].append(row.nome)
    grouped[phone]['contratos'].append(row.contrato)

items = [{
    'phone': phone,
    'name': ' / '.join(d['names']),
    'notes': ' + '.join(set(d['contratos'])),
} for phone, d in grouped.items()]
```

E no webhook, extrair primeiro nome do primeiro cliente:
```js
const firstName = student.name.split(/\s*\/\s*/)[0].split(/\s+/)[0];
```

**Por que funciona:** Em vez de "qual venceu o upsert?", o registro fica explícito ("Alana / Sofia") e a UX fica humana — saudação usa nome de uma das pessoas, e a equipe vê ambos na notificação.

---

## 2026-05-01 — UPSERT idempotente com ON CONFLICT DO UPDATE

**Contexto:** Quando precisa criar OU atualizar um registro pelo mesmo PK (ex: review por phone) sem 2 statements separados.

**Solução:** (`src/db.js`)
```js
db.prepare(`
  INSERT INTO conversation_reviews (phone, rating, comment, reviewed_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(phone) DO UPDATE SET
    rating = excluded.rating,
    comment = excluded.comment,
    reviewed_at = excluded.reviewed_at
`);
```

**Por que funciona:** Um único statement faz INSERT se não existe, UPDATE se existe. `excluded.col` = valor que SERIA inserido. Não precisa SELECT antes nem lógica de "se exists".

---

## 2026-05-01 — Estado aberto preservado entre rerenders (Set por phone)

**Contexto:** Painel admin re-renderiza lista de conversas a cada ação (avaliar, filtrar). Cards expandidos colapsavam, perdia contexto.

**Solução:** `Set<phone>` global no client. Toggle adiciona/remove. Ao re-renderizar, classe `.open` é aplicada baseado no Set.
```js
const openCards = new Set();
// no render:
<div class="conv-messages ${openCards.has(c.from) ? 'open' : ''}" data-phone="${c.from}">
// no toggle:
if (el.classList.contains('open')) openCards.add(phone);
else openCards.delete(phone);
```

**Por que funciona:** chave estável (phone) sobrevive a re-render que pode reorganizar índices. Estado é client-side, não precisa persistir.

---

## 2026-05-01 — Debounce de 600ms pra autosave de input

**Contexto:** Salvar comentário de review a cada keystroke = N requisições inúteis. Salvar só ao desfocar = perder dado se fechar aba.

**Solução:** (admin panel JS)
```js
const commentTimers = {};
function onCommentChange(phone, idx) {
  const text = document.getElementById('cmt-' + idx).value;
  clearTimeout(commentTimers[phone]);
  commentTimers[phone] = setTimeout(async () => {
    await fetch('/admin/api/reviews/' + phone, { method: 'PUT', ... });
  }, 600);
}
```

**Por que funciona:** Cada tecla cancela o timer anterior. Só dispara fetch quando para de digitar por 600ms. Por-phone evita interferência entre múltiplos inputs abertos.

---

## 2026-05-01 — Tag estruturada como sinal LLM → backend

**Contexto:** Quando o LLM precisa "avisar" o sistema que algo aconteceu (agendamento confirmado, captura de info, mudança de stage).

**Solução:** Inclui no prompt instrução pra LLM colocar tag formatada no início da resposta:
```
[AGENDAMENTO:nome=João|hora=9h|dia=terça|modalidade=musculação]
Resposta normal pro lead aqui...
```

Backend faz regex match, extrai os dados, salva, e remove a tag antes de enviar ao usuário.

```js
const apptMatch = answer.match(/\[AGENDAMENTO:([^\]]+)\]/i);
if (apptMatch) {
  const data = {};
  apptMatch[1].split('|').forEach(pair => {
    const [k, v] = pair.split('=');
    if (k && v) data[k.trim().toLowerCase()] = v.trim();
  });
  // ... salva no banco, notifica, etc.
  cleanText = answer.replace(/\[AGENDAMENTO:[^\]]+\]/gi, '').trim();
}
```

**Por que funciona:** O LLM já tem todo o contexto da conversa. Ele sabe quando algo importante aconteceu. Em vez de NLP/regex tentando adivinhar do texto cru, o LLM sinaliza explicitamente. Zero ambiguidade.

---

## 2026-05-01 — Prompt caching com cache_control ephemeral

**Contexto:** Prompt grande (~38k chars) recalculado a cada mensagem é caro.

**Solução:** (`src/agent.js`)
```js
const systemBlocks = [
  {
    type: 'text',
    text: SYSTEM_PROMPT,
    cache_control: { type: 'ephemeral' },  // cacheado por 5min
  },
];
if (dynamicCtx) {
  systemBlocks.push({ type: 'text', text: dynamicCtx });
}

const response = await client.messages.create({
  model: 'claude-sonnet-4-5-20250929',
  system: systemBlocks,
  ...
});
```

**Por que funciona:** Anthropic cobra 0.1x do input nos cache hits (90% desconto). Em conversa de 10+ mensagens em poucos minutos, paga só a 1ª e ganha desconto nas seguintes.

---

## 2026-05-01 — Prompt em 4 camadas (anti "lost in the middle")

**Contexto:** LLMs dão menos atenção ao meio de prompts longos. Regras críticas no meio se diluem.

**Solução:** Estrutura do prompt:
1. **TOPO BLINDADO** (alta atenção): identidade + 5 regras inegociáveis + antipadrão real
2. **REGRAS DETALHADAS** (meio): operacional comercial, base de conhecimento
3. **EDGE CASES** (meio-fim): públicos, cenários de borda
4. **LEMBRETE FINAL** (alta atenção): repete as 5 regras essenciais

**Por que funciona:** Repetição estratégica nas zonas de alta atenção compensa o efeito de diluição central. Reduziu prompt de 56k → 38k chars sem perder regras.

---

## 2026-05-01 — Migração SQL idempotente

**Contexto:** Adicionar coluna em tabela existente sem quebrar setup novos.

**Solução:** (`src/db.js`)
```js
// CREATE TABLE IF NOT EXISTS já tem a nova coluna pra setups novos
db.exec(`CREATE TABLE IF NOT EXISTS appointments (... scheduled_hour TEXT ...);`);

// Migração pra setups antigos
const cols = db.prepare('PRAGMA table_info(appointments)').all();
if (!cols.find(c => c.name === 'scheduled_hour')) {
  db.exec('ALTER TABLE appointments ADD COLUMN scheduled_hour TEXT');
  console.log('[db] migração: coluna scheduled_hour adicionada');
}
```

**Por que funciona:** Idempotente — roda em qualquer estado do banco. Bancos novos têm a coluna via CREATE TABLE; bancos antigos ganham via ALTER TABLE; bancos já migrados ignoram.

---

## 2026-04-30 — Estado por contato em SQLite com camada de normalização camelCase

**Contexto:** DB usa snake_case (audio_permission), código JavaScript usa camelCase (audioPermission). Não vazar essa conversão pelos consumidores.

**Solução:** (`src/agent.js`)
```js
function getContact(from) {
  const c = db.getOrCreateContact(from);
  return {
    phone: c.phone,
    name: c.name,
    audioPermission: !!c.audio_permission,
    awaitingAudioConfirm: !!c.awaiting_audio_confirm,
    askedForAudio: !!c.asked_for_audio,
    firstContactAt: c.first_contact_at,
    lastContactAt: c.last_contact_at,
  };
}

// Setter explícito (substitui mutação direta)
function setAudioFlags(from, updates) {
  const current = getContact(from);
  db.updateAudioFlags(from, {
    audioPermission: updates.audioPermission ?? current.audioPermission,
    ...
  });
}
```

**Por que funciona:** Consumidor (webhook.js) chama `setAudioFlags(from, { awaitingAudioConfirm: false })` em vez de `contact.awaitingAudioConfirm = false`. DB é detalhe interno do agent.js.

---

## 2026-04-30 — Tag temporal contextual ([LEAD_RETORNANDO_APÓS_X_DIAS])

**Contexto:** Quando lead volta depois de muito tempo (>30 dias), SDR não pode começar do zero — tem que reconhecer o retorno com naturalidade.

**Solução:** Calcula dias desde último contato no `agent.js`, injeta tag dinâmica no system prompt:
```js
if (isReturning) {
  dynamicCtx += `\n\n[LEAD_RETORNANDO_APÓS_${daysSinceLast}_DIAS] — esse lead já conversou contigo há ${daysSinceLast} dias. Histórico completo está no messages acima. Reconheça o retorno com zero julgamento. NÃO comece do zero, NÃO se reapresente. Tom acolhedor ("Bah, sumido!", "Tava te esperando").`;
}
```

**Por que funciona:** Tag é dinâmica (não cacheada), contém o número exato de dias e instruções explícitas. SDR responde: "Bah, sumido! Então, a gente tava conversando sobre seu objetivo de emagrecer..."

---

## 2026-04-30 — Sanitização de em-dash no código (dupla camada)

**Contexto:** Claude às vezes usa "—" (em-dash) mesmo com regra explícita no prompt. É marca registrada de IA em WhatsApp.

**Solução:** (`src/agent.js`)
```js
const beforeSanitize = cleanText;
cleanText = cleanText.replace(/\s*[—–]\s*/g, ', ');
if (beforeSanitize !== cleanText) {
  console.log(`[agent] sanitizou traço longo na resposta para ${from}`);
}
```

**Por que funciona:** Garantia em código complementa instrução no prompt. Mesmo se LLM falhar a regra, o usuário nunca recebe em-dash.

---

## 2026-04-30 — Detecção de horário comercial fechado (timezone-aware)

**Contexto:** Lead manda mensagem fora do horário (madrugada, domingo) — SDR precisa abrir avisando que é assistente virtual.

**Solução:** (`src/agent.js`)
```js
function isOutsideBusinessHours() {
  const now = new Date();
  const brt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const day = brt.getDay();
  const hour = brt.getHours();
  const min = brt.getMinutes();
  if (day === 0) return true;                    // domingo
  if (day === 6) return hour < 9 || hour >= 13;  // sábado 9h-13h
  if (hour < 6 || hour > 22) return true;
  if (hour === 22 && min >= 30) return true;
  return false;
}
```

Tag injetada como `[FORA_DO_HORÁRIO_COMERCIAL]` no contexto dinâmico só na 1ª mensagem.

---

## 2026-04-30 — Normalização de número brasileiro para Meta API

**Contexto:** Webhook recebe `from` com 12 dígitos (sem 9º dígito móvel). API de envio exige 13.

**Solução:** (`src/whatsapp.js`)
```js
function normalizeBRNumber(number) {
  if (number.startsWith('55') && number.length === 12) {
    return number.slice(0, 4) + '9' + number.slice(4);
  }
  return number;
}
```

**Por que funciona:** Insere `9` na posição correta (após país+DDD = 4 dígitos).

---

## 2026-04-30 — Webhook verification do Meta

**Contexto:** Meta faz GET no endpoint do webhook pra verificar antes de aceitar a URL.

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

**Por que funciona:** Meta envia `hub.challenge` e espera receber exatamente esse valor de volta com status 200.

---

## Estrutura de entrada esperada

```
## [Data] — [Nome curto da solução]

**Contexto:** onde e quando usar
**Solução:** o que faz / como funciona
**Código ou referência:** (trecho ou caminho do arquivo)
**Por que funciona:** aprendizado chave
```
