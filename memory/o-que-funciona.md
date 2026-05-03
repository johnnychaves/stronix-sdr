# O Que Funciona — Soluções Validadas

Padrões, trechos de código e abordagens confirmadas em produção/testes. Reutilize antes de reinventar.

---

## 2026-05-03 — Persona via placeholders no núcleo + assemble pure function

**Contexto:** Sócio queria controlar tom (gírias, abertura, frases proibidas) sem expor o núcleo inteiro pra edição via painel (PR #53 já tinha tirado o textarea do núcleo justamente porque admin podia quebrar a estrutura). Solução: subset SEGURO de slots de TOM.

**Padrão aplicado:**

1. **Placeholders no núcleo** ([src/prompt-nucleo-v2.js](../src/prompt-nucleo-v2.js)) — substituí listas hardcoded de gírias quentes/proibidas por `{{PERSONA_GIRIAS_QUENTES}}`, `{{PERSONA_GIRIAS_PROIBIDAS}}`, `{{PERSONA_FRASES_PROIBIDAS_EXTRA_BLOCK}}`. Adicionei linha "ABERTURA PADRÃO: `{{PERSONA_ABERTURA}}`" depois do "QUEM VOCÊ É".

2. **Pure function `assembleNucleoV2(personaPartial)`** ([src/persona-v2.js](../src/persona-v2.js)) — `mergeWithDefaults` + 4 `String.replace` globais. Sem I/O. `DEFAULT_PERSONA` calibrado pra produzir núcleo IDÊNTICO ao pré-persona quando admin não customizou.

3. **`getNucleoV2()` ramifica** — se admin setou `agent_config.nucleo_v2` (override TOTAL via API direta de emergência), usa esse texto bruto; senão `assembleNucleoV2(getPersona())`. `replyV2` e `simulateReplyV2` ambos chamam `buildSystemBlocks` → mesma função → mesma persona.

4. **Validação defensiva no merge** — `asString` e `asStringList` truncam item > 200 chars, lista > 30 items, filtram strings vazias, fazem fallback pro default em valores não-string/array. Sem throw.

5. **JSON inválido no DB cai pro default** — `getPersona()` faz `try/parse/catch`; se DB tem lixo, log warning + retorna default. Não derruba o agente.

**Trade-offs aceitos:**
- **Exemplo do anti-padrão no núcleo continua hardcoded** com "Opa beleza! Sou o Johnny da STRONIX 👋" mesmo se admin customizou a abertura. É demonstração ESTRUTURAL (mostra forma de tag + reação genuína), não comando. A INSTRUÇÃO oficial é a linha `ABERTURA PADRÃO:` que foi substituída — LLM segue essa.
- **Custom `nucleo_v2` (override total) BYPASSA persona.** Se admin usar curl pra PUT /api/agent-config/nucleo_v2, persona é ignorada. É emergência só, não tem UI. Documentado.
- **Persona não invalida prompt cache** — núcleo é cacheado por chamada (cache_control ephemeral), mudar persona = novo cache. Mudanças raras (admin edita uma vez), aceitável.

**Smoke validado:**
- 33/33 offline em [scripts/test-persona-assemble.js](../scripts/test-persona-assemble.js) (placeholders, conteúdo, custom, clamp, DB roundtrip, estabilidade, estrutura preservada)
- 1 cenário E.4 ao vivo via Anthropic em [scripts/smoke-persona-e4.js](../scripts/smoke-persona-e4.js): bot abriu com "Opa beleza! Sou o Johnny da STRONIX 👋" (default persona aplicada), defletiu pedido de valor com binária, parser limpou todas as tags. Custo $0.02 USD.

**Quando reusar este padrão:**
- Qualquer dado de TOM/STYLE que admin queira editar sem mexer em estrutura
- Permite separar "estrutura imutável" (no template) de "voz da marca" (na config) sem fork de código
- O importante é DEFAULT calibrado pra preservar comportamento atual quando não customizado

---

## 2026-05-03 — Optimistic UI: pendingMessages Map<phone, [...]> + render mesclado

**Contexto:** Painel admin tinha delay perceptível entre clicar Send e msg aparecer. Sensação de lentidão em UI moderna.

**Solução** ([src/admin.js](../src/admin.js)):
```js
const pendingMessages = new Map(); // phone → [{tempId, text, status, createdAt}]

async function sendChatReply(phone) {
  // ... extrai text + replyingTo
  const tid = tempId(); // 'tmp-{ts}-{rand}'
  const arr = pendingMessages.get(phone) || [];
  arr.push({ tempId: tid, text, status: 'pending', createdAt: Date.now() });
  pendingMessages.set(phone, arr);
  // Re-render imediato (bubble com ⏱ aparece antes do fetch)
  msgsEl.innerHTML = renderChatMessages(c);
  try {
    const r = await fetch(...);
    if (r.ok) { clearPendingByTempId(phone, tid); await loadConversations(); }
    else { markPendingFailed(phone, tid, error); }
  } catch { markPendingFailed(phone, tid, 'sem conexão'); }
}

function getMergedHistory(c) {
  const pend = pendingMessages.get(c.from) || [];
  return c.history.concat(pend.map(p => ({
    id: p.tempId, role: 'assistant', content: p.text,
    createdAt: p.createdAt, sentByUserId: me?.id,
    _pendingStatus: p.status, // 'pending' | 'failed'
  })));
}
```

`renderChatMessages` itera `getMergedHistory(c)` ao invés de `c.history` direto. Bubbles pending recebem classe `.pending` (opacity .62) e checkmark `⏱` pulsante. Failed = `.failed-send` (fundo vermelho) + botão `Tentar de novo` inline que chama `retrySend(phone, mid)`.

**Por que funciona:**
- Sensação de instantâneo (~0ms vs ~200-400ms antes)
- Race condition leve aceita (bubble pode duplicar < 200ms se SSE entrega real antes do POST retornar). Cleanup via `clearPendingByTempId` resolve.
- TempIds com `Date.now() + Math.random().toString(36)` colidem com prob ~0
- Estado em memória local, não sincroniza entre tabs — mas serve só pro feedback visual no envio próprio

---

## 2026-05-03 — Reply/citar via prefix `> ` no texto (sem tabela threads)

**Contexto:** WhatsApp Web tem citação de msg específica. Painel não tinha. Conversa de 50+ msgs fica difícil de costurar.

**Solução** ([src/admin.js](../src/admin.js)):
- Botão `.bubble-action-reply` (↩) hover-only no canto da bubble:
```css
.bubble-row:hover .bubble-action-reply { opacity: 1; }
.bubble-row.in .bubble-action-reply { right: -28px; }
.bubble-row.out .bubble-action-reply { left: -28px; }
```
- Click chama `setReplyTo(phone, mid)` que define `replyingTo = {phone, text}` (até 80 chars do trecho citado, sem citação anterior via `stripQuotePrefix`)
- Composer ganha `.composer-reply-preview` quando `replyingTo` ativo
- `sendChatReply` prepend `> ${replyingTo.text}\n\n` no texto enviado
- No render do bubble, `extractQuoteAndBody(text)` separa o bloco de quote do body:
```js
function extractQuoteAndBody(text) {
  const lines = text.split('\n');
  const quoteLines = [];
  let i = 0;
  while (i < lines.length && /^>\s?/.test(lines[i])) {
    quoteLines.push(lines[i].replace(/^>\s?/, '')); i++;
  }
  if (!quoteLines.length) return { quote: '', body: text };
  while (i < lines.length && lines[i].trim() === '') i++;
  return { quote: quoteLines.join('\n'), body: lines.slice(i).join('\n') };
}
```
- Bubble renderiza `.bubble-quote` (border-left + bg suave) acima do body

**Por que funciona:**
- **Single source of truth:** quote vive no texto. Não precisa de tabela `message_replies` nem campo `quoted_message_id`. WhatsApp renderiza `> ` como quote nativo do lado do lead.
- Não-quoted messages também passam pelo `extractQuoteAndBody` — quando não há `> ` no início, retorna `{quote:'', body: text}` sem custo perceptível.
- Esc no textarea cancela o reply via `clearReplyTo()` — UX igual WhatsApp.
- Trade-off aceito: histórico no DB tem `> trecho` literal. Aceitável.

---

## 2026-05-03 — Slash commands com dropdown navegável + management em localStorage

**Contexto:** Consultora repete frases padrão dezenas de vezes/dia (horários, valores, propostas). Snippets economizam tempo real.

**Solução** ([src/admin.js](../src/admin.js)):
- Trigger: textarea começa com `/` e ainda não tem espaço/quebra:
```js
function showQRDropdownIfTriggered(textarea) {
  const v = textarea.value;
  if (!v.startsWith('/') || /[\s\n]/.test(v)) { hideQRDropdown(); return; }
  const query = v.toLowerCase();
  qrDropdownMatches = quickReplies.filter(qr => qr.trigger.toLowerCase().startsWith(query));
  // Se nada bate, mostra todos pra discoverability
  if (!qrDropdownMatches.length) qrDropdownMatches = quickReplies.slice();
  // Render dropdown ...
}
```
- Navegação por teclado em `handleChatKey`:
```js
if (qrDropdownActive && qrDropdownMatches.length) {
  if (e.key === 'ArrowDown') { qrMoveActive(1); return; }
  if (e.key === 'ArrowUp')   { qrMoveActive(-1); return; }
  if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
    qrPick(qrDropdownIndex); return;
  }
  if (e.key === 'Escape') { hideQRDropdown(); return; }
}
```
- Click no item via `onmousedown="event.preventDefault();qrPick(${i})"` — preventDefault evita blur antes do click
- Dropdown fecha com debounce no blur: `onblur="setTimeout(hideQRDropdown, 150)"`
- 6 defaults seed populados na 1ª carga via `loadQuickReplies` se localStorage vazio
- Management em aba "Configurações → Atalhos rápidos" — CRUD inline com input `qr-trigger-input` (auto-prepend `/`) + `qr-text-input` + botão remover

**Por que funciona:**
- Zero back-end. localStorage `quickReplies` array `[{trigger, text}]`.
- Defaults seed dão valor imediato sem onboarding.
- Discoverability: `/` sozinho mostra todos → consultora descobre os disponíveis.
- Limitação aceita: não sincroniza entre consultoras/dispositivos. Se virar pedido, vira backend (`quick_replies` table + endpoints).

---

## 2026-05-03 — Notas internas por contato em localStorage (debounced)

**Contexto:** Consultora precisa anotar contexto sobre o lead que NÃO vai pro WhatsApp ("pediu pra ligar 18h", "esposa não autorizou", "comprou semestral em 2024"). Sem isso, vira anotação no caderno físico ou perde.

**Solução** ([src/admin.js](../src/admin.js)):
- Section nova em `renderLeadDetail`:
```js
<section class="detail-section">
  <h3>Notas internas (só você)</h3>
  <div class="detail-internal-notes">
    <textarea id="internal-note-input" placeholder="..."
      oninput="onInternalNoteChange('${c.from}')">${escapeHtml(loadInternalNote(c.from))}</textarea>
    <div class="notes-status" id="internal-note-status"></div>
    <div class="notes-help">Salvas no seu navegador. Não sincroniza entre consultoras.</div>
  </div>
</section>
```
- Storage prefixado por phone: `localStorage[internalNote:${phone}]`
- Debounce 500ms via `notesSaveTimer`:
```js
function onInternalNoteChange(phone) {
  clearTimeout(notesSaveTimer);
  notesSaveTimer = setTimeout(() => {
    saveInternalNote(phone, ta.value);
    status.textContent = ta.value.trim() ? 'Salvo no seu navegador' : 'Vazio';
  }, 500);
}
```

**Por que funciona:**
- Zero back-end. Salva ao parar de digitar.
- Microcopy explícita ("só você", "não sincroniza") seta expectativa correta.
- Limitação aceita: cada consultora tem suas próprias notas. Se virar pedido de sincronização, vira tabela DB + endpoints + SSE.

---

## 2026-05-03 — Skeleton loaders com shimmer CSS-only

**Contexto:** "Carregando..." em texto é amador. Skeleton em listas é padrão de produto polido.

**Solução** ([src/admin.js](../src/admin.js)):
```css
.skeleton-list { padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.skeleton-card {
  height: 64px; border-radius: 8px;
  background: linear-gradient(90deg, var(--bg-2) 0%, var(--bg-3) 50%, var(--bg-2) 100%);
  background-size: 200% 100%;
  animation: skShimmer 1.4s ease-in-out infinite;
}
.skeleton-card.compact { height: 44px; }  /* Inbox cards */
.skeleton-card.tall { height: 80px; }      /* Monitor v2 cards */
@keyframes skShimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

```html
<!-- Substitui "Carregando..." nos containers -->
<div id="inbox-list">
  <div class="skeleton-list">
    <div class="skeleton-card compact"></div>
    <div class="skeleton-card compact"></div>
    ...
  </div>
</div>
```

**Por que funciona:**
- Zero JS, zero deps. Pure CSS.
- Aspect-ratio do skeleton matches a real lista (compact pra Inbox que tem cards de 44px).
- Quando data carrega, `innerHTML = ` substitui o skeleton-list pela lista real.
- Animação shimmer (background-position) é GPU-accelerated, não trava UI.

---

## 2026-05-03 — Empty state com microcopy + ação contextual

**Contexto:** "Nenhuma conversa nesse filtro" sozinho é seco. Empty state bem feito tem ícone + título + sub + ação.

**Solução** ([src/admin.js](../src/admin.js)):
```js
function renderInboxList() {
  if (!convs.length) {
    const hasFilter = currentFilter !== 'all' || (searchQuery && searchQuery.trim());
    if (hasFilter) {
      list.innerHTML =
        '<div class="empty-state">' +
          '<div class="es-icon">🔍</div>' +
          '<div class="es-title">Nenhuma conversa com esse filtro</div>' +
          '<div class="es-sub">Tenta limpar o filtro ou busca pra ver todas as conversas.</div>' +
          '<button onclick="clearInboxFilters()">Limpar filtro</button>' +
        '</div>';
    } else {
      // ... versão sem filtro com microcopy diferente
    }
    return;
  }
  // ...
}

function clearInboxFilters() {
  searchQuery = ''; currentFilter = 'all';
  document.getElementById('inbox-search-input').value = '';
  // ... reset filter buttons
  renderInboxList();
}
```

**Por que funciona:**
- Diferencia "vazio porque filtro" vs "vazio porque ainda não chegou nada"
- Botão de ação inline reduz fricção — 1 click vs 3 (procurar onde está o filtro, achar como tirar, voltar)
- Reusável: `.empty-state` class com `.es-icon` / `.es-title` / `.es-sub` cobre vários contextos (qr-mgmt vazio, etc)

---

## 2026-05-02 — Baileys: JID resolution antes de enviar (bug 9-dígito BR)

**Contexto:** Mensagens enviadas via Baileys não chegavam no destinatário porque o JID gerado tinha o formato errado. WhatsApp BR registra contas em 2 formatos:
- 12 dígitos (sem 9): contas legadas
- 13 dígitos (com 9): contas novas

Mandar pro JID errado = msg vai pro vazio, sem erro algum.

**Solução** (`src/whatsapp-baileys.js`):
```js
async function resolveJid(to) {
  const clean = String(to).replace(/\D/g, '');
  const candidates = [clean];
  if (clean.startsWith('55') && clean.length === 13) {
    candidates.push(clean.slice(0, 4) + clean.slice(5)); // sem 9
  } else if (clean.startsWith('55') && clean.length === 12) {
    candidates.push(clean.slice(0, 4) + '9' + clean.slice(4)); // com 9
  }
  const jids = candidates.map(c => `${c}@s.whatsapp.net`);
  const results = await sock.onWhatsApp(...jids);
  const found = results?.find(r => r.exists);
  return found?.jid || jids[0]; // fallback no input original
}
```

`sock.onWhatsApp(...jids)` pergunta pro WhatsApp quais JIDs realmente existem. Sempre chame antes de `sendMessage` / `sendAudio`.

---

## 2026-05-02 — Canonicalização de phone no DB (lookup ±9 dígitos)

**Contexto:** Quando user cria contato `5551997564760` (com 9) no painel, sendMessage resolve pra `555197564760` (sem 9) via `onWhatsApp`. Quando o contato responde, msg chega com `555197564760`. DB tinha contato com 13 dígitos, busca não acha, cria novo contato — fica duplicado.

**Solução** (`src/db.js`):
```js
function canonicalizeContactPhone(phone) {
  if (!phone) return phone;
  const p = String(phone);
  if (stmts.getContact.get(p)) return p;
  if (p.startsWith('55') && p.length === 13 && p[4] === '9') {
    const without9 = p.slice(0, 4) + p.slice(5);
    if (stmts.getContact.get(without9)) return without9;
  } else if (p.startsWith('55') && p.length === 12) {
    const with9 = p.slice(0, 4) + '9' + p.slice(4);
    if (stmts.getContact.get(with9)) return with9;
  }
  return p; // não existe, retorna original (caller cria novo)
}
```

Aplicar em **todas** funções que recebem phone: `getOrCreateContact`, `addMessage`, `addMessageWithSender`, `updateLastContact`, `assumeConversation`, `releaseConversation`, `setLastAssistantMessageMediaPath`. Garante que ambos formatos caem no mesmo contato.

---

## 2026-05-02 — SSE com EventEmitter singleton + coalesce

**Contexto:** Polling 5s tinha latência percebível (3-5s) e gastava bandwidth (a lista inteira de conversas a cada poll).

**Solução** (`src/events.js`):
```js
const { EventEmitter } = require('events');
const bus = new EventEmitter();
bus.setMaxListeners(100);

const pendingConv = new Map();
const COALESCE_MS = 250;

function emitConversationChanged(phone) {
  if (!phone) { bus.emit('conversation.changed', { phone: null }); return; }
  if (pendingConv.has(phone)) return; // já agendado
  const t = setTimeout(() => {
    pendingConv.delete(phone);
    bus.emit('conversation.changed', { phone });
  }, COALESCE_MS);
  pendingConv.set(phone, t);
}
```

Coalesce de 250ms é crucial — quando webhook recebe msg, várias writes acontecem em rajada (`addMessage` + `updateLastContact` + `setLastAssistantMessageMediaPath` etc). Sem coalesce, cada write virava 1 evento, frontend recarregava conversations N vezes.

**Endpoint SSE**:
```js
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('X-Accel-Buffering', 'no'); // proxies não bufferizam
res.write(': sse-connected\n\n');           // hello inicial
const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25000);
req.on('close', () => clearInterval(heartbeat) /* + remove listeners */);
```

Heartbeat de 25s é importante — proxies (Cloudflare, nginx) cortam conexão idle após 30-60s.

**Frontend**:
```js
const sseSource = new EventSource('/admin/api/events');
sseSource.addEventListener('conversation.changed', e => loadConversations());
// EventSource reconecta sozinho — só logamos sseFailures pra debug
```

Polling fica como fallback (30s quando SSE saudável, 5s se SSE caiu repetidamente).

---

## 2026-05-02 — Knowledge base injetado no dynamicCtx (não invalida cache do prompt estático)

**Contexto:** Dados que mudam (preço de promo, horário) NÃO podem ficar no SYSTEM_PROMPT cacheado, senão cada edição invalida cache de 38k chars (custo pula 10x).

**Solução** (`src/db.js` + `src/agent.js`):
- Tabela `academia_info(key, value, label, category, ...)` editável
- `db.buildAcademiaInfoBlock()` monta texto formatado **só com chaves que têm valor** (vazias não vão pro prompt)
- Em `agent.reply()`:
```js
const systemBlocks = [
  { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
  { type: 'text', text: dynamicCtx },  // inclui buildAcademiaInfoBlock()
];
```

Bloco do KB começa com instrução explícita: *"Em caso de conflito com qualquer outra info no prompt, ESTES valem porque são gerenciados pela equipe."*

Resultado: editar 1 célula no painel = próxima resposta da IA usa valor novo. Cache do prompt estático preservado.

---

## 2026-05-02 — Pipeline áudio via Meta Cloud API: replicar o que JÁ funciona

**Contexto:** Saga de 6 PRs tentando configurar opus/ogg "canônico" pro envio de áudio funcionar. Cada tentativa falhava silenciosamente (Meta aceitava upload e `/messages` retornava 200 OK, mas o lead não recebia).

**Lição:** TTS já mandava áudio com sucesso há semanas via pipeline diferente. Em vez de continuar otimizando opus, **copiar o pipeline do TTS inteiro**:

| Item | TTS (funciona) | Manual (falhava) | Manual (depois do fix) |
|---|---|---|---|
| Format | audio/mpeg (MP3) | audio/ogg (Opus) | **audio/mpeg (MP3)** |
| HTTP client | fetch + native FormData | axios + FormData | **fetch + native FormData** |
| Field order | file → type → messaging_product | inverso | **file → type → messaging_product** |

**Código que funciona** (`src/whatsapp-meta.js` `uploadMedia`):
```js
const blob = new Blob([buffer], { type: mimeType });
const form = new FormData();
form.append('file', blob, filename);    // PRIMEIRO
form.append('type', mimeType);          // depois
form.append('messaging_product', 'whatsapp'); // por último
const res = await fetch(`.../media`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: form,
});
```

E ffmpeg sempre transcoda pra MP3 64kbps mono:
```js
const args = ['-loglevel', 'error', '-i', 'pipe:0',
  '-c:a', 'libmp3lame', '-b:a', '64k',
  '-ar', '44100', '-ac', '1', '-f', 'mp3', 'pipe:1'];
```

**Princípio geral:** quando uma parte do sistema já funciona em produção, **replique o caminho inteiro** antes de variar parâmetros baseado em "o que deveria funcionar segundo docs".

---

## 2026-05-02 — ffmpeg via Dockerfile (Nixpacks ignorava config)

**Contexto:** Tentei `nixpacks.toml` com `aptPkgs` e `nixPkgs` mas Railway boot mostrava `[server] ⚠️ ffmpeg NÃO encontrado no PATH`.

**Solução:** abandonar Nixpacks, usar Dockerfile explícito:

```dockerfile
FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg build-essential python3 ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "src/index.js"]   # node direto, NÃO npm start (npm engole stack traces)
```

Adicionar `.dockerignore` excluindo `node_modules`, `.git`, `data/`, `memory/`, `scripts/`, `.env`.

Railway detecta Dockerfile automaticamente e ignora Nixpacks.

---

## 2026-05-01 — Envio de áudio pra Meta Cloud API: usar MP3, não opus/ogg

**Contexto:** Painel admin precisa permitir consultora gravar e enviar voice message via WhatsApp. MediaRecorder do browser produz webm (Chrome) ou mp4 (Safari).

**Tentativas que NÃO funcionaram** (Meta aceitava upload + chamada `/messages` retornava 200 OK + `wamid.xxx`, mas mensagem **nunca chegava** no destinatário — silent reject sem webhook de erro):
1. Mandar webm direto → Meta rejeita (webm não está na lista oficial)
2. Transcode webm→ogg/opus com `-c:a copy` → falha silenciosa
3. Transcode com opus 64kbps estéreo → falha silenciosa
4. Transcode com opus mono 16kHz 32kbps `-application voip` (parâmetros "canônicos" de voice message) → falha silenciosa

**Solução que funciona:** copiar o pipeline EXATO que `src/tts.js` (TTS via ElevenLabs) usa em produção há semanas:

```js
// src/whatsapp.js - transcodeAudio
const args = [
  '-loglevel', 'error',
  '-i', 'pipe:0',
  '-c:a', 'libmp3lame',
  '-b:a', '64k',
  '-ar', '44100',
  '-ac', '1',
  '-f', 'mp3',
  'pipe:1',
];

// uploadMedia — fetch (NÃO axios) + ordem específica
const blob = new Blob([buffer], { type: 'audio/mpeg' });
const form = new FormData();
form.append('file', blob, 'voice.mp3');     // file PRIMEIRO
form.append('type', 'audio/mpeg');           // depois type
form.append('messaging_product', 'whatsapp'); // por último

await fetch(`.../media`, { method: 'POST', headers: { Authorization }, body: form });
```

**Aprendizado:** quando algo no pipeline já funciona em produção, **replique o caminho inteiro** em vez de tentar variações do que "deveria" funcionar segundo docs. A doc da Meta diz que aceita ogg/opus, mas na prática o caminho MP3 + fetch + ordem específica é o que entrega.

**Onde está:** [src/whatsapp.js](../src/whatsapp.js) (`transcodeAudio` + `uploadMedia`), [src/admin.js](../src/admin.js) (endpoint `/api/conversations/:phone/reply-audio`).

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
