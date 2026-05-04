# Log de Progresso

Registro cronológico de avanços importantes. Adicione entradas no topo (mais recente primeiro).

---

## 2026-05-03 — Persona expandida: nome agente + nome negócio + jeito + snapshot/undo

**Contexto:** Depois da persona inicial (4 slots: abertura, gírias, frases proibidas), sócio pediu mais autonomia: "preciso mudar o nome do Johnny e a forma que ele lida com o cliente — quero recepção mais calorosa em vez de séria". 3 slots novos pra cobrir identidade completa (não só tom).

**Slots novos:**
- `nomeAgente` (default "Johnny") — substitui em "Você é o {X}", "Sou o {X} da", header UPPER
- `nomeNegocio` (default "STRONIX") — substitui em "dono da {X}", "assistente virtual da {X}", header UPPER
- `descricaoJeito` (default "genuíno, sério, direto, sem papo de vendedor. Conhece todo mundo pelo nome. STRONIX é família, não academia de fisiculturista, \"gente como a gente\".") — substitui a frase de "Persona: ..."

**Placeholders no [src/prompt-nucleo-v2.js](src/prompt-nucleo-v2.js):**
- `{{PERSONA_NOME_AGENTE}}` + `{{PERSONA_NOME_AGENTE_UPPER}}`
- `{{PERSONA_NOME_NEGOCIO}}` + `{{PERSONA_NOME_NEGOCIO_UPPER}}`
- `{{PERSONA_DESCRICAO_JEITO}}`

**Snapshot/undo** ([src/persona-v2.js](src/persona-v2.js)):
- A cada `setPersona`, persona ANTERIOR vai pra `agent_config.persona_previous`
- `revertPersona()` faz swap: previous vira current, current vira previous (undo de undo possível)
- `resetPersona()` também guarda snapshot da custom antes de resetar
- 1 nível de undo é suficiente — evita complexidade de histórico longo

**Endpoints novos:**
- `GET /api/agent-config` agora retorna `persona.hasPrevious` e `persona.previous`
- `POST /api/agent-config/persona/revert` (admin only) — undo da última edição

**UI na aba Agente:**
- 3 inputs novos: nome agente, nome negócio, jeito (textarea)
- Botão "↶ Voltar para versão anterior" — só visível quando `hasPrevious=true`
- Help text "O que NÃO escrever" expandido com 3 exemplos:
  - ❌ "Sempre passa o valor" → módulo planos_e_precos
  - ❌ "Se o lead pedir aula, oferece terça às 9h" → módulo fluxo_aula_experimental
  - ❌ "Nosso plano custa R$199" → Conhecimento (academia_info)

**Validação intensiva (lição dos hotfix #55/#56):**
1. **45/45 offline** em [scripts/test-persona-assemble.js](scripts/test-persona-assemble.js) — placeholders, conteúdo default, custom (rename agente/negócio/jeito), clamp/validação, DB roundtrip, **6 testes novos de snapshot/revert** (1ª save sem snapshot, 2ª save cria, swap de revert, null sem previous, reset preserva)
2. **Grep de segurança** rodou: `grep -nE "(split|join|replace|match|trim|search|indexOf)\\('.n'\\)" src/admin.js` → **0 matches** (lição dos 2 hotfixes)
3. **Server local end-to-end** subiu, bootstrap admin via curl, fetch `/admin` retornou 308kb. **`new Function(scriptInline)` validou JS de 161kb sem erros** — confirma que TODO o `<script>` rendered tem sintaxe válida (não repete o bug do hotfix)
4. **Smoke E.4 com Anthropic real** PASS — persona default ainda gera núcleo de 12773 chars (mesmo size pré-persona), bot abre com "Opa beleza! Sou o Johnny da STRONIX 👋", parser limpa tags. Custo $0.02 USD.

**Por quê snapshot 1-nível e não histórico completo:**
- Resolve 90% do uso (admin edita errado, dá undo)
- Evita complexidade (tabela de versions, UI de diff)
- Se aparecer pedido real de "ver versão de 3 saves atrás", evolui depois

**Política mantida:** AGENT_VERSION=v2 default. Persona default produz comportamento idêntico ao pré-persona — migração silenciosa.

---

## 2026-05-03 — Persona da marca: aba Agente edita voz/tom sem mexer em estrutura

**Contexto:** PR #52 entregou aba Agente com edição do núcleo via textarea. PR #53 removeu o textarea do núcleo porque admin podia quebrar a IA editando estrutura. Faltava um meio-termo: deixar o admin ajustar tom (gírias, abertura, frases) sem expor regras estruturais. Sócio aprovou: "controle de tom antes do lançamento — pequenas coisas que só eu sei se soam Stronix".

**Implementação:**

**Placeholders no núcleo** ([src/prompt-nucleo-v2.js](../src/prompt-nucleo-v2.js)):
- Adicionada linha "ABERTURA PADRÃO (use literal na PRIMEIRA mensagem...): `{{PERSONA_ABERTURA}}`" logo após "QUEM VOCÊ É"
- Lista de gírias proibidas substituída por `{{PERSONA_GIRIAS_PROIBIDAS}}` (mantém wording "PROIBIDO: ...")
- Lista de gírias quentes substituída por `{{PERSONA_GIRIAS_QUENTES}}` (mantém wording "Substitutos quentes: ...")
- Marker `{{PERSONA_FRASES_PROIBIDAS_EXTRA_BLOCK}}` opcional (vazio se admin não preencheu lista extra)

**Módulo persona** ([src/persona-v2.js](../src/persona-v2.js) — novo):
- `DEFAULT_PERSONA` (frozen) com mesma abertura + gírias do núcleo pré-persona — assembleNucleoV2(default) produz string IDÊNTICA ao núcleo de antes
- `assembleNucleoV2(personaPartial)` — pure function, faz merge + 4 string.replace globais
- `mergeWithDefaults` clamp defensivo: item>200 chars trunca, lista>30 items corta, valor não-string/array cai pro default
- `getPersona()` lê `agent_config.persona` (JSON), com try/catch — JSON inválido → default + log
- `setPersona/resetPersona/isPersonaCustom` — wrappers pro DB
- LIMITS exposto pra UI mostrar maxLength

**Wire em [src/agent-v2.js](../src/agent-v2.js):**
- `getNucleoV2()` agora ramifica: se override total (`agent_config.nucleo_v2`) existe, usa direto (compat emergência); senão `assembleNucleoV2(getPersona())`
- Removido import dead code de `NUCLEO_V2_DEFAULT` (persona-v2 já carrega o template)
- **Paridade confirmada:** ambos `replyV2:376` e `simulateReplyV2:509` chamam `buildSystemBlocks()` → `getNucleoV2()` na linha 199. Sem fork.

**Endpoints REST** ([src/admin.js](../src/admin.js:667-720)):
- GET `/api/agent-config` retorna `persona: { current, default, isCustom, limits }` junto com nucleo+timing
- PUT `/api/agent-config/persona` aceita `{ value: { abertura, giriasQuentes, giriasProibidas, frasesProibidasExtra } }`. Valida shape (objeto não-array). `setPersona` faz normalize + serialize → DB
- DELETE `/api/agent-config/persona` apaga override (volta pro default)

**UI aba Agente** ([src/admin.js](../src/admin.js)):
- Section "🎭 Voz e tom da marca" com badge `(Default)`/`(Customizado)` no header
- 4 inputs: abertura (text, maxlength=200), 3 textareas (gírias quentes / gírias proibidas / frases proibidas extras), todas linha-por-linha
- Help text top: "Aqui ajusta como a IA fala: gírias, abertura, frases que tu não quer ver. Mexer aqui é seguro, não muda a estrutura nem as regras de venda. Mudança aplica na próxima resposta."
- **Box amarelo "⚠️ O que NÃO escrever aqui"** com 2 exemplos concretos (pedido específico do sócio):
  - ❌ `"Sempre passa o valor do plano logo no início"` → é regra estrutural, vai em Módulos do prompt
  - ❌ `"Se o lead pedir aula, oferece terça às 9h"` → é roteiro, fica no núcleo ou módulo `fluxo_aula_experimental`
- Auto-save debounce 800ms, status inline ("✏️ Editando..." → "✓ Salvo")
- Botão "↺ Restaurar default" com confirm

**Smoke validado:**
- **33/33 offline** em [scripts/test-persona-assemble.js](../scripts/test-persona-assemble.js): placeholders, conteúdo default preservado, custom substitui, clamp/validação, DB roundtrip com mock, estabilidade (sem mutação, idempotente), estrutura do núcleo mantida (TOPO BLINDADO, MÁQUINA DE ESTADO, REGRAS DE OURO, REGRA DOS VALORES, ANTI-PADRÃO, BLACKLIST, CHECAGEM FINAL)
- **Smoke E.4 com Anthropic real** ([scripts/smoke-persona-e4.js](../scripts/smoke-persona-e4.js)) — pedido firme do sócio antes de mergear:
  - Núcleo assembled = 12773 chars sem placeholders
  - Bot abriu com "Opa beleza! Sou o Johnny da STRONIX 👋" (default persona aplicada com sucesso)
  - Defletiu pedido de valor com binária ("Já chegamos lá. Mas antes me conta: tu tá treinando ou parado?")
  - Parser limpou tags ESTADO/MODULO/AGENDAMENTO — nenhum literal vazou no texto
  - Custo: $0.02 USD (~R$0.11)

**3 pontos do sócio respondidos:**
1. ✅ Help text com exemplos do que NÃO escrever — box amarelo com 2 exemplos concretos
2. ✅ Smoke pré-merge com persona default — E.4 PASS com Anthropic real
3. ✅ Paridade simulateReplyV2 ↔ replyV2 — confirmado no código (linhas 376 e 509 ambas via `buildSystemBlocks`/`getNucleoV2`)

**Política de flag mantida:** AGENT_VERSION=v2 já é default desde 2026-05-03. Persona é independente, default = sem mudança de comportamento.

---

## 2026-05-03 — Notas internas v2: backend sincronizado + bubble inline + toggle no composer

**Contexto:** Polish PR de manhã (#39) entregou notas em localStorage no sidebar direito. Sócio pediu redesenho: tirar do canto, virar bubble inline na conversa, toggle no composer ao lado do emoji, **e todas as consultoras veem as notas de todas**. Esse último item exige backend.

**Backend ([src/db.js](src/db.js)):**
- Tabela `internal_notes(id, phone, user_id, content, created_at)` + index `(phone, created_at)`. Migração idempotente via `CREATE TABLE IF NOT EXISTS`.
- Prepared statements: `insertInternalNote`, `getInternalNotesByPhone` (JOIN users pra display_name), `getInternalNoteById`, `deleteInternalNote`
- Helpers: `addInternalNote(phone, userId, content)` valida não-vazio + max 2000, canonicaliza phone; `getInternalNotesByPhone(phone)` → array; `deleteInternalNote(id, userId, isAdmin)` → `{ok, reason?}` com regra de permissão (autor ou admin)
- `getAllConversations` agora retorna `internalNotes: [...]` em cada conversation

**Endpoints ([src/admin.js](src/admin.js)):**
- `POST /admin/api/conversations/:phone/internal-notes` (requireAuth via `router.use`). Body `{content}`. Retorna `{ok, note}`. Emite `events.emitConversationChanged(phone)` pra SSE.
- `DELETE /admin/api/internal-notes/:id`. 403 se não-autorizado, 200 se ok. Emite SSE.

**Frontend ([src/admin.js](src/admin.js)):**

UI:
- **Removida** section "Notas internas (só você)" do sidebar direito (`renderLeadDetail`) + helpers `loadInternalNote/saveInternalNote/onInternalNoteChange` + constante `NOTES_STORAGE_PREFIX` + CSS `.detail-internal-notes` antigo
- Adicionado botão `📝` no `chat-input-pill` ao lado do `😊` (`<button class="chat-note-toggle">`)
- Indicator "📝 Nota interna — só o time vê, não vai pro lead" acima do composer quando ativo
- CSS novo: `.chat-input-pill.note-mode` (tint amber sutil), `.note-mode-indicator`, `.bubble.note` (centralizada, fundo amber dark), `.note-header`, `.note-delete`

Comportamento:
- Estado global `noteModeActive`. `toggleNoteMode(e, phone)` inverte + força rebuild do composer + limpa `replyingTo` se ativo (quote não combina com nota)
- `sendChatReply` redireciona pra `sendInternalNote(phone, text)` quando `noteModeActive`
- `sendInternalNote`: optimistic UI com pending bubble flag `isNote: true`, POST endpoint, sucesso → `loadConversations` + reset modo, falha → `markPendingFailed`
- `deleteNote(noteId)`: confirm + DELETE + loadConversations
- `getMergedHistory(c)` agora junta `c.history + c.internalNotes + pending`, sort por `createdAt` ASC
- `renderChatMessages` checka `m._isNote === true` e renderiza bubble especial: header "📝 Nota interna · Autor", body, ✕ delete pra autor/admin (hover-only)
- `messagesStamp` inclui notes count + last note createdAt pra que SSE/polling re-renderize quando outra consultora anota

**Smoke E2E validado:**
- Server local com env dummies sobe ✅
- Login admin → POST /contacts/init cria contato → POST /internal-notes cria nota id=1, id=2 ✅
- GET /conversations retorna `internalNotes: [...]` com 2 notas (autor "Admin") ✅
- POST com content vazio → 400 "Nota vazia" ✅
- DELETE /internal-notes/1 → 200 ✅
- GET de novo → 1 nota restante ✅
- Extração do `<script>` do `/admin` rendered → `node --check` passa OK (lição do hotfix #40 aplicada)
- Grep no HTML rendered confirma: 5x `chat-note-toggle`, 4x `note-mode-indicator`, 3x handlers `toggleNoteMode/sendInternalNote/deleteNote`, 6x CSS `.bubble.note`, 2x refs `internalNotes`

**Trade-offs aceitos** (registrados em [memory/decisoes.md](decisoes.md)):
- Hard delete sem soft delete
- Sem edição (apaga + recria)
- Limit 2000 chars
- Sem markdown
- Notas em localStorage do PR #39 ficam órfãs

**Política mantida:** `AGENT_VERSION=v1` continua default. Notes v2 é independente do trilho v2.

---

## 2026-05-03 — Polish PR frontend (Optimistic UI + Reply + Quick replies + Notas + Skeleton/Empty)

**Contexto:** Antes de soltar o painel pra outras consultoras (hoje só Johnny opera) e antes de ligar v2 em 5%, janela natural pra polir UX. PR único frontend-only em [src/admin.js](src/admin.js) (monolítico 6242 linhas). Princípio: tudo em localStorage + handlers, zero back-end novo.

**5 features entregues:**

1. **Optimistic UI no envio** — bubble aparece instantâneo com ⏱ pulsante (`msg-check.pending` animação shimmer), vira ✓ quando servidor confirma via `loadConversations`. Em erro vira ⚠ com botão "Tentar de novo" inline. Implementação: `pendingMessages` Map<phone, [{tempId, text, status, createdAt}]>, `getMergedHistory(c)` concatena history real + pending, `renderChatMessages` itera o merged. `clearPendingByTempId` remove no sucesso, `markPendingFailed` marca falha. `retrySend(phone, mid)` reabilita pending e re-tenta.

2. **Reply / citar mensagem** — botão `.bubble-action-reply` (↩) revela em hover na bubble, click chama `setReplyTo(phone, mid)` que popula `replyingTo = {phone, text}` e força rebuild da composer. Preview com `.composer-reply-preview` mostra trecho citado (até 80 chars), X cancela ou Esc no textarea. Send prepend `> {trecho}\n\n` no texto. WhatsApp renderiza `> ` como quote nativo do lado do lead. No painel, `extractQuoteAndBody(text)` separa quote do body, renderiza `.bubble-quote` estilizado dentro da bubble. Não exige tabela/campo novo no DB.

3. **Quick replies (slash commands)** — digita `/` no início da composer dispara `showQRDropdownIfTriggered(textarea)`, mostra `.quick-reply-dropdown` acima do input com matches por prefix. ↑↓ navega (`qrMoveActive`), Enter/Tab expande (`qrPick`), Esc fecha (`hideQRDropdown`). 6 snippets seed (`/aula`, `/valores`, `/horario`, `/endereco`, `/agendar`, `/ola`). Aba nova "Configurações → Atalhos rápidos" pra CRUD: `qrMgmtRender/qrMgmtAdd/qrMgmtUpdateTrigger/qrMgmtUpdateText/qrMgmtDelete`. localStorage `quickReplies` (array `[{trigger, text}]`).

4. **Notas internas** — section nova na sidebar direita (`renderLeadDetail`) com textarea + status de salvamento + microcopy "Salvas no seu navegador. Não sincroniza entre consultoras". `loadInternalNote(phone)` lê de `localStorage[internalNote:${phone}]`, `onInternalNoteChange` debounced 500ms grava via `saveInternalNote`. Limitação aceita: não sincroniza entre consultoras nem dispositivos. Se virar pedido, vira backend depois (tabela `internal_notes` + endpoints + SSE).

5. **Skeleton loaders + Empty states** — todos os 8 placeholders `<div class="empty">Carregando...</div>` substituídos por `<div class="skeleton-list">` com 3-5 `.skeleton-card` shimmer animados (compact pra inbox, tall pra v2-monitor). Inbox vazia com filtro ativo mostra `.empty-state` com SVG icon + microcopy "Nenhuma conversa com esse filtro" + botão "Limpar filtro" (chama `clearInboxFilters()`). Inbox vazia sem filtro: "Aguardando primeira conversa". Variantes de empty-state também usadas no qr-mgmt sem snippets.

**Arquivos modificados:**
- [src/admin.js](src/admin.js) — todas as mudanças (frontend monolítico). +~370 linhas CSS, +~250 linhas JS, modificações em `renderChatMessages`, `sendChatReply`, `buildInputBar`, `handleChatKey`, `autoGrowChat`, `renderLeadDetail`, `switchTab`, `setActiveNav`, `renderInboxList`. Nova aba `tab-atalhos` com painel de gerenciamento.

**Smoke server-side:**
- `node --check src/admin.js` ✅ syntax válido
- Server sobe local com env dummy (PORT=3001, WHATSAPP_PROVIDER=meta com creds dummy + dummies pra Anthropic/OpenAI/ElevenLabs)
- Bootstrap admin via `/admin/api/auth/bootstrap` ok, retorna cookie de sessão
- GET `/admin` autenticado retorna 200 com 258676 bytes
- Grep no HTML rendered confirma: `skeleton-card` (11x), `qr-mgmt-list` (3x), `Atalhos rápidos` sub-item (3x), `detail-internal-notes` (6x), `composer-reply-preview` (7x), `setReplyTo`, `loadQuickReplies`, `internal-note-input` todos presentes
- Smoke browser via Claude in Chrome bloqueado por permission prompt — adiado pra validação visual pelo Johnny ao abrir o painel

**Trade-offs aceitos:**
- Quick replies em localStorage = não sincroniza entre consultoras nem dispositivos. v1 ok, v2 vira backend se virar pedido.
- Notas internas idem.
- Reply usa `> ` no texto ao invés de tabela threads. Single source of truth, WhatsApp renderiza nativo. Render no painel via `extractQuoteAndBody`.
- Bubble pendente pode aparecer brevemente duplicada se SSE entrega o real ANTES do POST retornar (race < 200ms). Aceitável.

**Política de flag mantida:** `AGENT_VERSION=v1` continua default. Polish PR é independente do trilho v2 — não afeta agente nem prompt.

---

## 2026-05-02 — PR #37: Admin Tooling (Trilha B) — pré-requisito da janela de validação

**Contexto:** Último PR antes de ligar `AGENT_VERSION=v2` em 5%. Constrói toda a tela de monitoramento que o Johnny vai usar diariamente durante a janela de 50 conversas / 14 dias.

**Componentes entregues:**

A. **Tela de monitoramento** ([src/admin.js](src/admin.js) — nova aba "🚦 Monitor v2"):
- Lista de conversas v2 com filtros: em andamento / agendou / handoff / perdeu (>24h)
- Cada linha: phone mascarado (últimos 4 dígitos `5599999000****`), estágio, última msg, tempo decorrido, módulo pendente
- Painel lateral com detalhe completo: ficha do lead em tempo real, tags emitidas, eventos recentes, histórico cronológico
- Botões 3-níveis: ✅ Deu certo / ⚠️ Aceitável / ❌ Deu errado + textarea autosalva
- Filtro avaliação: todas / não avaliadas / só ❌ / só ⚠️ / só ✅

B. **Painel de métricas em tempo real** (cards + funil):
- % agendou / % handoff / % perdeu (com filtro 1h/today/7d/14d/30d)
- % tag esquecida (instrumentação combinada PR33) — destaca em vermelho se >30%
- % `routeModules() === []` (instrumentação combinada PR34)
- Distribuição por estágio (gráfico de barras CSS-only)
- Tempo médio do primeiro contato até `agendamento_confirmado`
- Crashes / preço inventado / valor antecipado (cards com bg vermelho se >0)

C. **Banner de alertas** + nav badge ([src/db.js#getV2Alerts](src/db.js)):
1. 3 reviews `bad` consecutivas → critical
2. Preço inventado em 24h → critical
3. Valor antecipado (antes 3ª insistência) em 24h → critical
4. Tag esquecida em >30% das últimas 20 conversas → warning
5. Crashes em 24h → critical

D. **Botões de controle**:
- ⏸ **Pausar v2 imediatamente** (confirmação dupla, escreve `agent_version_override='v1'` em `v2_runtime_flags`, `webhook.js` lê via `getCurrentAgentVersion()` a cada request — sem restart)
- ▶ Retomar (volta pra env baseline)
- ⟳ **Forçar resumo agora** por conversa específica (botão pedido no review do PR36)
- ⬇ Exportar CSV do período (streaming)

E. **Onboarding tour** (4 steps, `localStorage.v2m_tour_seen` evita re-aparecer):
- Boas-vindas / Métricas e funil / Como avaliar / Pausa de emergência

**Backend novo:**
- [src/db.js](src/db.js): migração `conversation_reviews` extends pra aceitar `'aceitavel'` (table-rebuild idempotente via `sqlite_master.sql` check), nova tabela `v2_metrics_log` (append-only com índices), nova tabela `v2_runtime_flags`. Helpers: `logV2Event`, `countV2Events`, `listV2Events`, `getV2Conversations` (com status derivado), `getV2ConversationDetail`, `getV2Metrics`, `getV2Alerts`, `getRuntimeFlag/setRuntimeFlag`, `maskPhone`, `isValidReviewRating`.
- [src/v2-detectors.js](src/v2-detectors.js) **novo** (~110 linhas): `extractMoneyValues`, `isLikelyDerivation`, `detectsPrecoInventado` (compara contra `academia_info`, aceita derivações <15% do menor preço), `detectsValorAntecipado`, `detectsTagEsquecida`. Falsos positivos aceitos — admin marca "falso alarme" via UI futuro.
- [src/agent-v2.js](src/agent-v2.js): instrumentação inteira em `replyV2`. Try/catch externo loga `CRASH`. Após Roteador, loga `ROUTER_EMPTY` se `[]`. Após resposta, loga `TAG_ESQUECIDA`/`TURN_OK`, `PRECO_INVENTADO`, `VALOR_ANTECIPADO`. Detectores em try/catch interno — NUNCA derruba `replyV2`.
- [src/webhook.js](src/webhook.js): variável `AGENT_VERSION_ENV` (baseline do env) + `getCurrentAgentVersion()` que checa override em DB. Permite pausa runtime instantânea via UI.
- [src/admin.js](src/admin.js): 10 endpoints novos `/api/v2/*` — `conversations`, `conversation/:phone`, `metrics`, `alerts`, `review/:phone`, `force-resumo/:phone`, `version`, `pause`, `resume`, `export`. SSE forwarding `v2.metrics.changed` no endpoint existente.

**Tests:**
- [scripts/test-v2-detectors.js](scripts/test-v2-detectors.js) **novo**: 33/33 (cobre regex monetário, derivações, preço inventado, valor antecipado, tag esquecida, extração do academia_info).
- Suite offline total: **133/133** (21 regex-valor + 39 router + 14 state-update + 26 resumo + 33 detectors).

**Seed:**
- [scripts/seed-v2-test-conversations.js](scripts/seed-v2-test-conversations.js) **novo**: 5 cenários sintéticos (em_andamento / agendou / handoff / perdeu / tag_esquecida) com phones `5599999000+id`. Eventos sintéticos pra tag esquecida alimentando métrica em 36.4% (>30% → alerta amarelo). Permite testar tela ANTES de ligar v2 em prod (critério de aceitação).

**Smoke local validado** via Chrome MCP:
- Login admin → aba Monitor v2 → tour aparece → métricas carregam → 5 conversas listadas com badges de status corretos → click conversa → detalhe lateral abre com ficha completa + histórico + 3 botões avaliação → click ✅ → marcador ✓ aparece imediatamente na lista.
- Bug encontrado e corrigido: `state.isAdmin` referência fora de escopo no IIFE (variável da app principal). Removida (endpoint já checa `requireAdmin`).
- Bug encontrado e corrigido: tempo médio negativo no seed (last_contact < first_contact). Seed agora atualiza ambos retroativos.

**Bateria pós-PR37 (zero regressão):**
- 22/22 sem crash. Custo $0,30. Bateria E: 3/6 (dentro da variabilidade 3-5 confirmada no PR36 com 5 runs).
- F.1 (Fase 3) ✅ continua passando — instrumentação não atrapalhou Roteador/Resumo.
- E.2/E.2_EXT/E.3 oscilam (variabilidade do Sonnet, known issue PR33).

**Política de flag mantida:** `AGENT_VERSION=v1` continua default. Pré-requisitos antes de v2 em 5%:
1. ✅ PR37 mergeado (admin tooling)
2. ⏳ Smoke manual playground v2 (Johnny faz, ~30min)
3. ⏳ Liga `AGENT_VERSION=v2` em 5% via hash
4. ⏳ Janela de 50 conversas / 14 dias

---

## 2026-05-02 — Fase 3: Resumo dinâmico em background (PR #36) + refactor pós-review

**Contexto:** Conversas longas (20+ msgs) carregavam 50 msgs cheias no prompt cada turno → token bloat + cache miss. Fase 3 substitui por (resumo estruturado + últimas 10 msgs).

**Implementação inicial (commit `b4c4baf`):**
- [src/resumo-dinamico.js](src/resumo-dinamico.js) novo: `shouldUpdateResumo`, `gerarResumo` (Haiku 4.5 fire-and-forget), `updateResumoDinamicoBackground`, `buildResumoBlock`
- [src/db.js](src/db.js): migração coluna `resumo_dinamico_n_msgs`, helper `getAllMessages`
- [src/agent-v2.js](src/agent-v2.js): replyV2 + simulateReplyV2 + buildSystemBlocks (camada 4.5)
- [scripts/test-resumo-dinamico.js](scripts/test-resumo-dinamico.js): 16 unit tests
- Cenário F.1 nas baterias

**Refactor pós-review (commit `83a313d`):** 4 ajustes do Johnny + 1 bonus
1. **Doc mestre no repo:** 6 arquivos copiados de `~/Downloads/` pra [docs/refactoring/](docs/refactoring/). Resolve gap estrutural (mesmo problema do PR33).
2. **Threshold 15 → 20** atualizado no Anexo 5 com nota explicativa (mantém valor da implementação por análise de conversas reais).
3. **Prompt 6 → 10 seções** estruturadas do Anexo 5 (LEAD, OBJETIVO, DISPONIBILIDADE, MODALIDADE INDICADA, INSISTÊNCIAS DE VALOR, OBJEÇÕES JÁ LEVANTADAS, NÍVEL DE ENGAJAMENTO, INFOS PESSOAIS RELEVANTES, HISTÓRICO DE TENTATIVAS DE FECHAMENTO, PRÓXIMA AÇÃO RECOMENDADA). **Bonus:** `gerarResumo()` agora aceita `state` opcional e passa `insistencias_valor` + `objecoes_levantadas` como CONTEXTO ADICIONAL pro Haiku — vêm do backend, mais confiáveis que parsing impreciso do transcript.
4. **Sanity check `validateResumoSchema`:** regex valida ≥3 das 10 seções no formato esperado. Se falhar, descarta retorno → próximo trigger tenta de novo. DB não recebe lixo.
5. **Alinhamentos com Anexo 5:** header `RESUMO DA CONVERSA ANTERIOR` → `CONTEXTO PRÉVIO`; history fixo de 10 últimas msgs.

**Validação 5 runs (variabilidade vs regressão):**
Bateria E rodou 5 vezes com mesmo código (`83a313d`):
- Distribuição: 3, 4, 3, 4, 5 (oscila → variabilidade confirmada → não-regressão)
- F.1 (Fase 3): **5/5 = 100%** — Sonnet incorpora resumo consistentemente em todas as runs
- E.4 (parser): 5/5 = 100%
- E.3, E.1, E.2_EXT oscilam (variabilidade do Sonnet em respostas longas com `objecao_ativa` — known issue do PR33)
- Custo: ~$1,50 USD pelas 5 runs

**Suite offline total: 100/100** (21 regex-valor + 39 router + 14 state-update + 26 resumo-dinamico, +10 testes novos cobrindo `validateResumoSchema`).

**Política de flag:** `AGENT_VERSION=v1` continua default. Smoke manual no playground v2 + Trilha B (admin tooling — PR37) ainda pré-requisitos antes de v2 em 5%.

---

## 2026-05-02 — PR #34 mergeado + decisões pra próximas fases (PR #35)

**PR #34 (Fase 2 — Roteador) mergeado** após review com 4 perguntas + 2 ajustes do Johnny. Todos atendidos: respostas honestas no body, EXT_E2 cenário estendido criado e passou ✅, output da bateria fixado em `<details>`, bloco "Decisão arquitetural" adicionado, janela temporal definida pra métricas (50 conversas OU 14 dias).

**Decisões persistidas pra próximas fases (em [memory/status.md](memory/status.md) e [memory/decisoes.md](memory/decisoes.md)):**

1. **Métrica adicional pro rollout 5%:** medir `% turnos com routeModules() === []` (zero módulos carregados, evidência de cobertura insuficiente das 39 regras). Critérios: <5% mantém arquitetura determinística, 5-15% considera Fase 2.5 na próxima janela, >15% abre Fase 2.5 como prioritária.

2. **Smoke manual no playground v2 é PRÉ-REQUISITO firme** antes de cogitar `AGENT_VERSION=v2` em 5%. 5-10 cenários reais via UI (Configurações → Testar agente). Não pula essa etapa.

3. **Template padrão de PR (meta-aprendizado):** ajustes recorrentes do reviewer viram checklist obrigatória, não dependem de "lembrar de fazer". Checklist atual em [decisoes.md](memory/decisoes.md) com 6 itens (após PR36, expandida pra incluir doc mestre no repo + multi-run pra confirmar variabilidade).

4. **Variabilidade de tag esquecida no Sonnet 4.5 confirmada como limitação intrínseca.** E.3 passou no PR33 e falhou no PR34 com código de núcleo praticamente idêntico — evidência ao vivo. Validação multi-run no PR36 reconfirmou (3-5 oscila com mesmo código). Não tentar mais fix de prompt; aguardar rollout pra medir taxa real e decidir Fase 6 (tool use estruturado) conforme critérios.

**Próximo passo operacional:** smoke playground (não foi feito ainda). Sem ele, nada de v2 em produção.

---

## 2026-05-02 — Fase 2: Roteador determinístico de módulos (PR #34)

**Contexto:** Após PR33 mergear (3 fixes pré-Fase 2), construído o Roteador da Fase 2. Antes, replyV2 só carregava `modulo_pendente` do turno anterior — IA caia em fallback "deixa eu confirmar com a equipe" em conversas com objeção/contexto fora do roteiro principal. Agora o Roteador decide dinamicamente quais módulos carregar.

**Decisão arquitetural — determinístico, sem Haiku:**
- Princípio sócio: cobre 80% dos casos com 20% do esforço
- Regras heurísticas em [src/router-v2.js](src/router-v2.js) (estado + keywords)
- Latência: zero (sub-ms vs +300-500ms de chamada Haiku)
- Custo: zero extra
- Se aparecer caso edge real em produção, evolui pra híbrido com Haiku 4.5

**Estrutura do `routeModules({ state, text, modulo_pendente })`:**

1. **Tag manual preservada:** `modulo_pendente` (do turno anterior, via tag `[MODULO_REQUERIDO:nome]`) sempre incluído
2. **Estado-based:**
   - `estagio_atual === 'apresentacao_planos'` → `planos_e_precos`
   - `estagio_atual === 'proposta_visita'` ou `'drill_horario'` → `fluxo_aula_experimental`
   - `objecao_ativa` preenchido → `objecao_${X}` + `objecoes_geral` (15 mapeados em `OBJECAO_TO_MODULE`)
3. **Keyword-based (regex pt-br):** 18 regras cobrindo públicos especiais (gestante, idoso, adolescente, obeso), saúde/lesão (joelho, hérnia, cirurgia), objeções via texto (gympass, esposa, mensal), info academia (estacionamento, horário), modalidades, política de plano (cancelamento, fidelidade, pix), provas sociais, concorrência
4. **Limit defensivo:** `MAX_MODULES = 3` (evita prompt bloat / cache miss)
5. **Dedup automático** via Set

**Testes:**
- [scripts/test-router-v2.js](scripts/test-router-v2.js): 39 casos cobrindo cada regra individualmente + combinações (estado + keyword + modulo_pendente). **39/39 passou** offline (sub-100ms)
- [scripts/test-state-update.js](scripts/test-state-update.js): 14 casos unitários de `computeStateUpdate` + `computeInsistenciasValor` (mudança de objeção, force handoff em 3, clamp de insistências). **14/14 passou** offline

**Bateria A-E re-rodada via [scripts/baterias-v2.js](scripts/baterias-v2.js):**
- 21/21 sem crash. Custo: $0,28 (~R$1,52)
- **Bateria E: 3/4 passou** — subiu de 2/4 (PR33) → **3/4** (PR34)
- E.1 (mudança de objeção): ❌ → ✅ (Roteador carregou módulos certos baseados em `objecao_ativa`)
- E.3 (conversa longa): ✅ continua ✅
- E.4 (tag malformada): ✅ continua ✅
- E.2 (3 tentativas → handoff): ❌ persiste, mas não é bug do código — cenário de 4 turnos não exercita lógica (bot leva 2 turnos pra começar a marcar `objecao_ativa`, sobrando só 2 tentativas reais). **Lógica de force handoff coberta em [test-state-update.js](scripts/test-state-update.js) com 14/14 passando.**

**Comparação Fases 0+1 → Fase 2:**

| Métrica | PR32 (Fase 0+1) | PR33 (fixes) | PR34 (Fase 2) |
|---|---|---|---|
| Bateria E asserts | 1/4 | 2/4 | **3/4** |
| Módulos carregados por turno | 0-1 (só pendente) | 0-1 | **0-3 dinâmicos** |
| Resposta com `objecao_ativa=preco` carrega `objecao_preco`? | ❌ não, só se Johnny pediu | ❌ | **✅ automático** |
| Lead diz "tem estacionamento?" carrega `info_academia`? | ❌ | ❌ | **✅ por keyword** |
| Custo extra por turno | $0 | $0 | **$0** (determinístico) |
| Latência extra por turno | 0ms | 0ms | **<1ms** |

**Próximo passo após PR34 mergear:** smoke real em playground v2 + validação com 5-10 conversas simuladas via UI antes de cogitar `AGENT_VERSION=v2`. Política firme: v1 continua default mesmo após Fase 2 mergeada.

---

## 2026-05-02 — Validação Bateria A-E do agent v2 (PR #32) via script

**Contexto:** Antes de construir Fase 2 (Roteador), rodar os 21 cenários do PG_CENARIOS pra confirmar que a infra do v2 (parser, máquina de estado, regra de valores, handoff por tentativas) funciona.

**O que foi feito:**
- Criado [`scripts/baterias-v2.js`](scripts/baterias-v2.js) — roda 21 cenários via `simulateReplyV2`, gera relatório markdown
- Rodou 21/21 sem crash. Custo: ~$0,22 USD (~R$1,21)
- Relatório: [`scripts/baterias-v2-result.md`](scripts/baterias-v2-result.md)
- Asserts da Bateria E: **1/4 passou** (E.4 só)

**Findings — em ordem de severidade:**

| # | Sev | Onde | O que | Causa raiz |
|---|---|---|---|---|
| 1 | 🔴 Alto | E.3 — prompt núcleo | Bot trava em `qualificacao_objetivo` por 5+ turnos. Lead respondeu "João" (turno 4), "tarde" (5), "quarta" (6), "14h" (7), "beleza confirmado" (8) e bot continua re-perguntando "resultado físico vs qualidade vida". Conversa nunca chega em `proposta_visita` → nunca emite `[AGENDAMENTO]`. | Núcleo não tem regra "se lead pular etapas com sinal claro de avançar (dia/hora/confirmação), capturar e progredir o estágio". |
| 2 | 🟡 Médio | `simulateReplyV2` | Não replica linhas 312-329 do `replyV2`: append em `objecoes_levantadas`, reset/incremento de `tentativas_objecao_atual`, force `estagio_atual=handoff_humano` em 3 tentativas. | Função do playground foi escrita simplificada. Causa direta das falhas E.1 e E.2. Em produção (replyV2) essa lógica existe e funciona. |
| 3 | 🟡 Médio | `simulateReplyV2` | Não chama `detectsValueRequest` + auto-incremento de `insistencias_valor` (linhas 252-254 do replyV2). LLM ainda emite via tag, mas auto-incremento backend é silent fallback. | Mesma causa: simulate simplificado. |
| 4 | 🟡 Médio | A.4 turnos 3-7 + outros | Bot não emite `[ESTADO:...]` em todo turno mesmo o núcleo dizendo que é OBRIGATÓRIA. Em A.4: tag presente nos turnos 1-2, ausente em 3-7. | Núcleo precisa reforço/exemplo do anti-padrão. Em produção, replyV2 mantém estado anterior se vier sem tag — não corrompe DB, mas perde rastreabilidade. |
| 5 | 🟢 Baixo | E.3 turno 15 | Resposta veio vazia (`> ` apenas). Bot recebeu "preciso adiar pra outra semana" e emitiu só a tag `[ESTADO:...]` sem texto pro lead. | Bug raro mas embaraçoso em produção. Núcleo deve forçar mínimo 1 frase de texto sempre. |

**O que FUNCIONOU bem (seguir replicando):**
- Roteiro de qualificação 7 turnos completo (A.4): oi → parado → emagrecer → Maria → manhã → terça → 9h → confirma "Terça às 9h tá confirmado pra tua aula experimental" ✓
- Insistências de valor 1/2/3 detectadas corretamente (A.3, B.1, E.1, E.2)
- Tabela do mais caro pro mais barato após 3ª insistência ✓
- Virada obrigatória pra aula experimental após valores ✓
- Defletir Gympass sem perder o roteiro (B.4) ✓
- Handoff direto pra: lesão (C.3), aluno financeiro (D.2), grosseria (D.3) ✓
- Reposicionamento contra plano mensal (B.5) ✓
- Públicos especiais marcam módulo `publicos_especificos` (C.1, C.2) ✓
- Parser robusto: tag malformada não crasha, parser limpa do texto (E.4) ✓

**Próximos passos discutidos:**
1. Decidir se fixes precedem Fase 2 (Roteador) ou se o Roteador resolve naturalmente Finding #1
2. Não foi aberto PR — relatório local pra Johnny decidir

---

## 2026-05-02 — Fixes pré-Fase 2 aplicados (Bateria E: 1/4 → 2/4)

**Contexto:** Após validação que mostrou Bateria E 1/4 + bug crítico E.3 (loop em qualificacao_objetivo), aplicados 3 fixes locais no worktree antes de seguir pra Fase 2 (Roteador).

**O que mudou:**

1. **Fix A — Paridade `simulateReplyV2` ↔ `replyV2`** ([agent-v2.js](src/agent-v2.js))
   - Extraídas 2 funções puras compartilhadas: `computeInsistenciasValor(currentInsist, userText)` e `computeStateUpdate(currentState, parsed)` — retorna `{ stateFields, appendedObjecao }`
   - `replyV2` chama as funções puras, persiste via `db.appendObjecaoLevantada` + `db.updateLeadState`
   - `simulateReplyV2` chama as MESMAS funções, atualiza state em memória (com dedup em `objecoes_levantadas`)
   - Adicionado auto-incremento de `insistencias_valor` no simulate (linha 367) — antes só replyV2 fazia
   - Garante `objecoes_levantadas` como array no simulate (proteção contra null vindo do cliente)
   - **Efeito:** Playground agora simula corretamente lógica de mudança de objeção, force handoff em 3 tentativas, etc.

2. **Fix B — Bug E.3 (loop em qualificacao_objetivo)** ([prompt-nucleo-v2.js](src/prompt-nucleo-v2.js))
   - Adicionada seção "REGRA ANTI-LOOP — LEAD PULOU ETAPA (CRÍTICA)" na máquina de estado
   - Adicionado anti-padrão concreto "ANTI-PADRÃO 2: LOOP IGNORANDO SINAL DE AVANÇO" com exemplo certo vs errado
   - Regra: se lead respondeu sinal claro (nome, manhã/tarde, dia, hora, "confirmado") sem responder a binária pendente, CAPTURA o sinal e AVANÇA estágio. Pode pedir 1x a info pulada, mas nunca fica em loop.
   - **Efeito em bateria:** E.3 passou de FAIL → PASS. Bot agora avança "tarde" → "quarta" → "14h" → "fechado" e emite `[AGENDAMENTO:nome=João|dia=quarta|hora=14h|modalidade=pilates]` corretamente. **Corrigiu bug REAL de produção** que travava agendamento em conversas atípicas.

3. **Fix C — Tag obrigatória + texto mínimo** ([prompt-nucleo-v2.js](src/prompt-nucleo-v2.js))
   - Adicionado TOPO BLINDADO 🚨 antes de "QUEM VOCÊ É" forçando tags na linha 1+2 e texto na linha 3+
   - Adicionados itens 7 e 8 nas Regras de Ouro
   - Adicionados itens 1-2 e 4 na Checagem Final
   - **Efeito parcial:** Bot emite tag em respostas curtas ("Te vejo quarta", "Aceita Pix") agora — mas continua esquecendo em respostas longas/elaboradas de objeção (E.1, E.2). Limitação intrínseca do LLM em respostas com argumentação extensa.

**Re-validação (após fixes):**
- 21/21 sem crash
- **Bateria E: 2/4 passou** (E.3 + E.4) vs 1/4 antes
- E.1 mudou de 1 entrada → 0 entradas em `objecoes_levantadas` (regressão tática mas trade-off aceitável: bot priorizou rebater objeção com argumentos longos sobre emitir tag)
- E.2 ainda falha por mesma razão
- Custo total: $0,22 (~R$1,21)

**Trade-off aceito:** Fix C v2 (topo blindado) ganhou E.3 (agendamento real captura) e perdeu rastreabilidade em E.1 (objeções não persistem 100% no histórico). Em produção, `replyV2` mantém estado anterior se tag faltar — não corrompe DB, só perde rastreabilidade pra debug. **Agendamento real é mais crítico que histórico fiel de objeções.**

**O que segue não-resolvido:**
- Bot esquece tag `[ESTADO:]` em respostas longas elaboradas (Findings residuais E.1, E.2). Solução cirúrgica seria migrar pra **tool use estruturado** da Anthropic SDK (em vez de tag no texto), mas isso é re-arquitetura que não cabe agora.
- Sugestão pra futuro: adicionar log de warning em `replyV2` quando turno vem sem `[ESTADO:]` pra dar visibilidade em produção.

**Decisão:** fixes locais commitados, NÃO foi feito push nem aberto PR. Aguardando sinal do Johnny pra: (a) push + abrir PR, (b) seguir pra Fase 2 sem PR (acumula fixes), ou (c) descartar e revisitar.

---

## 2026-05-02 — Maratona: design completo + Baileys + features de produção (PRs #1 a #30)

Sessão longa que evoluiu o sistema de "MVP funcional" pra "plataforma feature-complete pronta pra produção". 30 PRs mergeados.

### Visão geral por área

#### 🎨 Design system completo (PRs #1, #2, #3, #13, #14, #17, #28)
Fonte: handoff bundle do Claude Design (claude.ai/design) — design system "STRONIX SDR".

- **Login** (#1): tela de 2 colunas com painel da marca à esquerda (gradient + logo + headline + bubble preview), formulário à direita com glow verde no foco. Mantém modo bootstrap dinâmico.
- **App shell** (#2): substituiu top tabs por **left rail icon-only** (64px, expande pra 240px no hover; Cmd+B fixa, salvo em localStorage). Topbar com breadcrumb (#28 removeu depois). User pill no rodapé com avatar gerado das iniciais.
- **Inbox 3 colunas** (#3): lista | chat | ficha do lead (320px) — substituiu coluna "Em atendimento" antiga.
- **Bubbles redesenhadas** (#13): tail triangular, agrupamento de msgs consecutivas, links auto, hover lift, distinção de cor IA vs humano.
- **Padding fix** (#14): `chat-messages` `padding: 8% → 14px` — bubbles encostam nas bordas em vez de flutuar central.
- **Composer WhatsApp Web** (#17): `[+] [pill com textarea + emoji embutido] [mic|send swap]`. Mic vira send quando tem texto.
- **Topbar removida** (#28): breadcrumb e status pill saíram, ✏️ "nova conversa" foi pro header da lista.

#### 💬 Features de conversa (PRs #15, #18, #19)
- **Emoji picker** (#15): 8 categorias, 350+ emojis, recentes em localStorage, insert no cursor (não no fim), Esc/click fora fecha.
- **Modal "Nova conversa"** (#18): busca contato existente OU número novo. Detecta texto vs número, normaliza BR (`(51) 99530-4633` → `5551995304633`), oferece criar.
- **Busca aluno + msg direto** (#19): botão "Mandar msg" em cada aluno cadastrado. Modal de nova conversa também busca em `allStudents`. Erros Meta amigáveis (131047 = janela 24h, 131026 = num inválido).

#### 🔊 Áudio bidirecional (PRs #4, #5, #6, #7, #8, #9, #10, #11, #25)
**A saga do áudio** — 8 PRs até resolver. Lições aprendidas em [o-que-funciona.md](o-que-funciona.md).
- (#4) UI de gravação no composer: mic → modo recording → preview → send via base64
- (#5) ffmpeg via nixpacks (não funcionou)
- (#6) ffmpeg via nixpacks com aptPkgs+nixPkgs (também não funcionou)
- (#7) **Switch pra Dockerfile** (`node:20-slim` + `apt install ffmpeg`)
- (#8) `CMD node` direto em vez de `npm start` pra stack traces aparecerem
- (#9) Transcode sempre pra ogg/opus
- (#10) Params canônicos de voice message (mono 16kHz 32k voip)
- (#11) **FIX FINAL**: copiar pipeline do TTS (MP3 + libmp3lame 64k + fetch + ordem `file/type/messaging_product`). User percebeu que TTS já mandava áudio com sucesso há semanas.
- (#12) Player inline no painel (MP3 salvo em `/data/media/<uuid>.mp3` + endpoint `/api/media/:filename`)
- (#25) IA também salva áudio em disco (antes só mostrava texto descritivo)
- Checkmarks ✓ ✓✓ ✓✓ azul (#12)

#### 🔌 Migração pra Baileys (PRs #20-#24, #26)
**Decisão:** trocar Meta Cloud API por Baileys pra remover restrição de janela 24h. Detalhes em [decisoes.md](decisoes.md).

- (#20) Integração Baileys via toggle `WHATSAPP_PROVIDER=meta|baileys`. Facade pattern em `src/whatsapp.js` delega pro provider ativo. Auth state em `/data/baileys-auth/`.
- (#21) Botão "Desconectar e trocar número" + página `/admin/baileys/qr` redesenhada com auto-refresh.
- (#22) **JID resolution via `onWhatsApp`** — bug do 9-dígito BR (mensagem ia pro vazio porque destinatário tinha 12 dig e gerávamos 13).
- (#23) **LID resolution** — WhatsApp privacy mode envia `<lid>@lid` em vez do phone real, criando contato duplicado.
- (#24) **Canonicalização de phone no DB** — friend respondia com 12-dig, DB tinha 13-dig, criava contato novo. Fix: lookup das 2 variações antes de gravar/buscar.
- (#26) **Aba "Conexões"** em Configurações — gerencia conexão pelo painel, sem precisar abrir URL avulsa.

#### ⚡ Real-time + notificações (PRs #27, #29)
- (#27) **SSE** — `/admin/api/events` substitui polling 5s. EventEmitter singleton (`src/events.js`) propaga `conversation.changed`, `connections.changed`, `appointments.changed`, `students.changed`. Latência ~100ms vs 3-5s. Polling fica de fallback (30s quando SSE saudável).
- (#29) **Sistema de notificação** — banner persistente quando WhatsApp tá fora + toast stack pra eventos pontuais (msg failed, janela 24h fechada, num inválido). Browser notification quando aba em background.

#### 🧠 Editar e treinar agente — Fase 1+2 (PR #30)
- **Knowledge base estruturado** (`academia_info` table): 16 chaves por categoria (planos, modalidades, horários, contato, promo, diferenciais). UI editável em "Configurações → Conhecimento" com save automático no blur. `db.buildAcademiaInfoBlock()` injeta no `dynamicCtx` da IA — mudanças aparecem na próxima resposta sem invalidar o cache de 38k chars.
- **Playground** ("Configurações → Testar agente"): chat isolado pra simular conversa com IA. Não toca DB de mensagens nem WhatsApp. Mostra tokens (input + cache + output), latência, custo estimado em R$. `agent.simulateReply()` paralelo ao `reply()` mas sem efeitos colaterais.

### Estado de fim de sessão
- ✅ Todas features mergeadas em main, em produção
- ✅ Baileys conectado no número pessoal do Johnny pra teste — funcional
- ✅ IA respondendo, áudio bidirecional, painel multi-agente, SSE em tempo real
- ⏳ Próximo passo operacional: trocar do número pessoal pro número da academia (pausar JetSales no número, abrir Conexões → Desconectar → escanear QR novo)

### O que NÃO foi feito (próximas fases)
- Fase 3 — Version history do prompt (snapshots + diff + revert)
- Fase 4 — Coaching loop (👎 vira form "como deveria ter respondido" → few-shot)
- Fase 5 — Tone settings (sliders formal/casual, curto/extenso)
- Multi-número (hoje suporta 1)

---

## 2026-05-01 — Redesign WhatsApp Web da aba Inbox

**Contexto:** O Johnny pediu pra deixar o painel "mais sofisticado, intuitivo e profissional" e trazer a parte de mensagens "o mais próximo possível do layout do WhatsApp oficial", além de criar um menu lateral com alunos em atendimento ativo.

**O que mudou:** layout da aba "Conversas ativas" reescrito do zero pra 3 colunas estilo WhatsApp Web:

1. **Sidebar esquerda (360px) — Lista de conversas**
   - Header com contador + botão refresh
   - Search bar (filtra por nome, telefone ou conteúdo da última msg)
   - Filtros pills compactos: Todas / 🤖 IA / 👤 Humano / ⭐ Minhas / Não avaliadas / 👍 / 👎
   - Cards com avatar circular gradiente (verde STRONIX, laranja humano, verde claro "minhas"), nome/phone formatado, preview da última msg com prefix 🤖/👨‍💼/👤, timestamp relativo (29 min, 14h, etc), mini badges (você/nome consultora/review)

2. **Centro — Área de chat**
   - Header com avatar grande, nome do lead, status ("🟢 Em atendimento (você)" / "🤖 IA atendendo"), telefone formatado
   - Botões: Assumir/Devolver pra IA, 📝 review (popup), Limpar
   - Mensagens em bubbles estilo WhatsApp:
     - Outgoing IA: verde escuro #005c4b à direita
     - Outgoing humano: verde médio #00785e com nome do atendente em verde claro
     - Incoming (lead): cinza escuro #202c33 à esquerda
     - Day dividers ("Hoje", "Ontem", data) entre dias diferentes
     - Hora pequena no canto inferior direito de cada bubble
   - Input fixo no fundo: textarea com auto-grow, Enter envia (Shift+Enter quebra linha), botão redondo verde com ícone ➤
   - Estado "vazio" (nenhuma conversa selecionada): emoji 💬 grande + texto

3. **Sidebar direita (280px) — Em atendimento**
   - Lista das conversas com `assignedUserId != null`
   - Cada item: nome, contagem msgs, "há X min", consultora dona (ou "Você" se for sua)
   - Item selecionado: borda esquerda verde
   - Esconde em telas <1100px

**JS reorganizado:**
- Estado: `selectedPhone`, `searchQuery`, `chatScrollPinned`
- 3 funções de render: `renderInboxList()`, `renderChat()`, `renderActives()`
- Polling re-renderiza os 3 (ou só o que mudou via diff)
- `chatScrollPinned`: detecta se usuário tá no fim do chat pra manter autoscroll quando chega msg nova
- Helpers: `escapeHtml`, `getInitials`, `fmtPhone`, `fmtRelativeTime`, `fmtMessageTime`, `fmtDayDivider`
- Responsivo: telas <800px viram single-column tipo mobile WhatsApp

**Smoke test visual (Chrome MCP):**
- Login → painel principal → click "Conversas ativas" → screenshot
- Layout 3 colunas renderizou perfeitamente
- Click em conversa → chat abre no centro com bubbles, header populado, input ativo (porque já assumida)
- Sidebar direita lista a conversa em atendimento com destaque verde

---

## 2026-05-01 — Inbox multi-agente integrado (10 dias de plano executados em 1)

**Contexto:** Decisão estratégica de NÃO migrar pra ChatPro/Wati (R$ 200-500/mês recorrente + IA genérica) e construir o inbox no nosso próprio painel. Mantém custom IA (Sonnet 4.5 + 38k prompt + voz clonada) + adiciona multi-agente. Custo recorrente extra: R$ 0.

**Plano original em 10 dias úteis, executado em 1 sessão por deploy incremental.**

**Day 1 — Schema (DB):**
- Tabelas `users` (id, username, password_hash, display_name, role, phone, active) e `sessions` (token UUID, user_id, expires_at)
- Colunas em `contacts`: `assigned_user_id` (FK soft), `human_assumed_at` (timestamp)
- Coluna em `messages`: `sent_by_user_id` (NULL = IA, ID = consultora)
- 12 helpers novos: createUser/authenticateUser/getUserById/getAllUsers/setUserActive/setUserPassword/setUserRole/setUserPhone/setUserDisplayName/deleteUser/countUsers/countAdmins/getActiveConsultors/getActiveAdmins
- Migrações idempotentes (PRAGMA table_info)

**Day 2 — Auth (src/auth.js):**
- Hash com scrypt do crypto built-in (sem dep nova) — formato `salt$hash`
- `verifyPassword` usa `crypto.timingSafeEqual` (resistente a timing attacks)
- Parser de cookie manual (~10 linhas, sem cookie-parser)
- Middleware `requireAuth` e `requireAdmin`
- Cookie `sdr_session` httpOnly + sameSite=lax + secure em prod
- Detecta produção via NODE_ENV ou RAILWAY_ENVIRONMENT

**Day 3 — Login UI:**
- Tela /admin/login com modo bootstrap quando `countAdmins() === 0`
- Form muda dinamicamente: bootstrap pede displayName + phone, login normal só user/senha
- Header do painel com nome do user + role + botão "Sair"
- Endpoint /api/auth/status público pra cliente saber se está em bootstrap

**Day 4-5 — Reply + assume/release:**
- POST /api/conversations/:phone/reply: garante contato, assume se ninguém pegou, salva msg como assistant com sent_by_user_id, envia via Cloud API
- POST /api/conversations/:phone/assume: race protection com UPDATE WHERE assigned_user_id IS NULL
- POST /api/conversations/:phone/release: limpa assignment, IA volta a atender
- UI: badges (🤖 IA / 👤 nome / ⭐ minha), botão Assumir/Devolver/Enviar, input dentro do card
- Filtros novos: IA atendendo / Humano atendendo / Minhas

**Day 6 — Webhook handoff:**
- `processBatch` checka `human_assumed_at` antes da IA. Se assumida: salva msg do user, NÃO chama Claude, notifica consultora ou fallback de admins.
- `notifyAssignedConsultor` em whatsapp.js: prioriza consultora atribuída, fallback pros admins. Pula se ninguém tem phone cadastrado.

**Day 7 — Polling + Notifications:**
- Polling 5s na aba Inbox, pausa nas outras
- Detecção de msgs novas comparando `lastContactAt` entre loads
- Browser Notification API (permissão pedida no carregamento)
- Contador de não-lidas no título (só conta com aba oculta)
- visibilitychange + focus zera o counter

**Day 8 — Aba Usuários (admin only):**
- CRUD com proteção: não desativa nem rebaixa o último admin, não exclui a si mesmo
- Reset de senha invalida todas as sessões do user (força re-login)
- Endpoint enxuto /api/users-public retorna só id+display_name+role pra renderizar nomes em mensagens

**Day 9 — Aba Métricas (admin only):**
- 6 cards: total conversas 30d, em atendimento humano agora, % handoff, tempo médio 1ª resposta IA, pendentes de assumir 24h, total alunos
- Lista de conversas atendidas por consultora 30d (count distinct phones)
- Tudo via `db.getMetrics()` em prepared statements

**Day 10 — QA + memory + deploy.**

**Smoke tests passados (auto):**
- Auth: 11/11 (redirect, 401, bootstrap, login, logout, cookie invalidado)
- Handoff: lead manda msg pra conversa assumida → IA NÃO roda, log "em atendimento humano (Johnny) — IA não responde"
- Users CRUD: cria, lista, role-based access (consultora 403 em /users e /metrics), proteção último admin

**Princípio sócio aplicado:** zero deps novas (scrypt + cookie parser manual), polling em vez de websocket, HTML inline em vez de React. Mantém o estilo simples do código, sem build, sem framework.

---

## 2026-05-01 — Buffer de mensagens (debouncing por phone)

**Contexto:** Lead/aluno costuma fragmentar pensamento em várias msgs curtas ("oi" → "tem aula?" → "qual valor?"). Sem buffer, cada uma virava webhook independente, IA processava 3x e respondia fora de ordem — especialmente crítico depois que o delay de digitação subiu pra 1-3 min, abrindo janela enorme pra race condition.

**Solução:** janela de debounce de 15s por phone.

**Como funciona:**
- Webhook resolve text (transcreve áudio se preciso) e chama `enqueueMessage(from, text, isAudio)`
- `enqueueMessage` empilha no Map `buffers` por phone, cancela timer anterior e agenda novo timer de 15s
- Quando 15s passam SEM nova msg do mesmo phone, `flushBuffer` dispara `processBatch`
- `processBatch` (extraído do antigo handler POST):
  - Concatena msgs com `\n` → vira o "text" da chamada da IA
  - `anyAudio` = qualquer msg do batch foi áudio
  - `explicitAudio` = qualquer msg pediu áudio explicitamente em texto
  - `firstText` = 1ª msg de texto (pra avaliar isAffirmative/isNegative no fluxo de awaitingAudioConfirm)
  - Roteamento aluno vs lead, depois reply() com texto concatenado, depois delay 1-3 min, depois envia

**Tradeoffs aceitos:**
- Lead que manda 1 msg só agora espera 15s + 1-3 min (era 0 + 1-3 min). Custo pequeno, simplicidade alta.
- Histórico no DB fica com 1 msg do user contendo texto concatenado, em vez de N msgs fragmentadas. No painel aparece junto, separado por `\n`.
- Buffer é em memória — restart do servidor perde msgs pendentes (raro no Railway).

**Race condition residual:** durante o sleep de 1-3 min após o flush, lead pode mandar mais msgs e gerar um SEGUNDO batch que processa em paralelo. Mitigação futura (se virar problema via review do painel): lock por phone.

**Smoke test:** 3 webhook POSTs em 2s → buffer acumula (1,2,3) → 15s depois → 1 flush → 1 chamada Claude com texto concatenado de 32 chars. Confirmado.

---

## 2026-05-01 — Importação em massa de alunos (planilha STRONIX)

**Contexto:** STRONIX compartilhou XLSX `clientes-01_05_2026.xlsx` com 621 linhas, 602 contratos ativos. Construir bulk import era o próximo bloqueio antes de ligar o número real.

**O que foi feito:**
- Endpoint `POST /admin/api/students/bulk` com transação única (limite 5000 itens). Retorna `{ inserted, updated, skipped }`.
- Helper `bulkUpsertStudents` em `db.js` usando `db.transaction()` do better-sqlite3 (rollback automático em erro).
- Limite de body do Express subido pra 1MB (default 100KB era apertado pros 594 itens).
- Script `scripts/import_students.py` com openpyxl: filtra `Situação do contrato == Ativo` AND `Situação do cliente == Ativo`, normaliza phone `(51) 9 9984-9349 → 5551999849349`, agrupa múltiplos clientes ativos no mesmo phone (família) num único registro com nomes concatenados por " / ".
- Webhook ajustado: `firstName` extrai 1º nome do 1º cliente em registros agrupados (`"Alana / Sofia" → "Alana"`).

**Achado interessante:** 8 phones na planilha aparecem com 2 clientes ativos cada — todos casos óbvios de família (mãe/filha, irmãos, casal). Pelos sobrenomes: Tozin, Silveira, Medeiros/Gusmão, Nunes, Pereira (×2), Silveira/Pacheco, Maria/Rielem. Não é erro de cadastro — é realidade. Pro propósito do roteamento, agrupar funciona: IA desvia igual, e a notificação pra equipe mostra ambos os nomes.

**Smoke test local:** 602 itens enviados → 594 phones únicos no banco. Família Tozin agrupada como esperado. Bulk endpoint testado com banco zerado (594 inserted, 0 updated) e re-execução (0 inserted, 594 updated) — idempotência confirmada.

**Resultado em produção:** 594 alunos ativos cadastrados. Quando qualquer um deles mandar msg, IA NÃO roda → resposta padrão + notificação WhatsApp pro dono.

---

## 2026-05-01 — Roteamento aluno vs lead + delay de digitação

**Contexto:** Pergunta do usuário sobre como o sistema vai lidar quando virar número oficial da STRONIX — alunos atuais e leads novos no mesmo canal. Decisão: Modelo A (mais simples e seguro).

**Roteamento aluno vs lead (Modelo A):**
- Tabela `students` (phone PK, name, notes, created_at) com upsert idempotente (ON CONFLICT)
- Helpers: `isStudent`, `getStudent`, `upsertStudent`, `getAllStudents`, `deleteStudent`
- Check ANTES de chamar IA no webhook.js: se phone está em students, **IA NÃO roda** (zero token, zero risco de oferecer aula experimental pra quem já paga)
- Resposta padrão (com primeiro nome se disponível): *"Oi Mariana! Aqui é o assistente da academia, mas pra coisas de aluno eu te passo direto pra equipe. Já avisei eles e logo te respondem 👋"*
- `notifyStudent()` em whatsapp.js: notifica dono (OWNER_PHONE_NUMBER) com nome do aluno, telefone formatado e preview da mensagem (até 200 chars)
- Endpoints REST + aba "🎓 Alunos" no painel admin: form com phone+nome+notes, lista, botão remover, sanitização de phone (só dígitos)
- Validação dupla: cliente exige ≥12 dígitos, servidor exige ≥10

**Delay de digitação:**
- Função `typingDelayMs(text) = Math.min(3000, Math.max(1000, text.length * 25))` ≈ 40 chars/seg
- Aplicado antes do `sendMessage` de texto (resposta normal e fallback de aluno)
- Áudio pulado: TTS ElevenLabs já tem latência natural de 2-3s
- Curta ("oi"): 1000ms. Longa (200 chars): 3000ms.

**Smoke test:** DB layer + endpoints HTTP testados. Upsert, isStudent, getAllStudents, DELETE, validação de phone inválido (400) — tudo verde.

**Princípio sócio aplicado:** risco assimétrico. Aluno mal atendido cancela (perda de receita recorrente). Prospect mal atendido só vai embora. Modelo A elimina o risco trocando potencial atendimento de aluno por escalada determinística pra humano.

---

## 2026-05-01 — Simplificação da Camada 1: 2 ratings em vez de 3

**Contexto:** Camada 1 saiu com 3 botões (👍 Boa / 👎 Ruim / 🚩 Marcada). Usuário achou confuso. Sócio-mode: 🚩 era redundante — tu pode marcar 👎 sem certeza ainda e refinar depois. 3ª categoria pra "talvez" complica sem ganho real.

**O que mudou:**
- DB: CHECK constraint de `rating` reduzido pra `('good', 'bad')`. Migração idempotente: `UPDATE` qualquer row com `rating='flagged'` pra `'bad'`.
- Endpoint: validação aceita só `good`/`bad` (testado: PUT com `flagged` retorna 400).
- UI: botão 🚩 e filtro 🚩 removidos. Labels atualizados pra "👍 Gostei" e "👎 Não gostei" (linguagem do usuário). CSS de `.flagged` removido (código morto).
- Default em `onCommentChange`: era `'flagged'` se não tinha review, agora é `'bad'` (premissa: se tu tá comentando sem clicar, é problema).

**Smoke test:** server reiniciou, PUT good ✅, PUT flagged → 400 ✅, PUT bad ✅. Review do lead fake limpa pra teste fresh.

---

## 2026-05-01 — Camada 1 do sistema de coleta de feedback

**Contexto:** Antes de mexer em arquitetura pra "esquecimento" do SDR, precisa de evidência real. Sócio-mode: não otimize o que não está medido. Camada 1 = avaliação manual de conversas.

**O que foi feito:**
- Tabela `conversation_reviews` (phone PK + FK pra contacts, rating, comment, reviewed_at) com índices em rating e reviewed_at
- Helpers no `db.js`: `upsertReview` (ON CONFLICT DO UPDATE), `getReview`, `getAllReviews`, `deleteReview`. Review embutida em `getAllConversations` pra rendering único.
- 3 endpoints REST: `GET /admin/api/reviews`, `PUT /admin/api/reviews/:phone` (com validação de rating + 404 se phone inexistente), `DELETE /admin/api/reviews/:phone`
- UI no painel admin (aba Conversas): badge da avaliação no header + barra inferior por card com botões 👍 / 👎 / 🚩 + textarea de comentário (debounce 600ms pra autosave)
- Filtros no topo: Todas / Não avaliadas / 🚩 / 👎 / 👍 com contador "X de Y"
- Estado aberto/fechado dos cards preservado entre rerenders via `Set<phone>` (evita perder contexto ao avaliar)

**Smoke test:** server sobe, upsert funciona (cria → atualiza), 404 em phone inexistente, 400 em rating inválido, DELETE remove, review aparece embutida em GET conversations.

**Decisão sócio:** descartado fazer Camada 2 (funil/métricas) e Camada 3 (custo por lead) agora. Aguardar 2 semanas de uso real e ler comentários pra decidir o que faz sentido construir depois.

---

## 2026-05-01 — Sistema de agendamento completo + hora específica

**O que foi feito:**
- Tabela `appointments` no SQLite com colunas: phone, name, modality, scheduled_day, scheduled_turn, scheduled_hour, status (pending/confirmed/cancelled/no_show), created_at
- Tag `[AGENDAMENTO:nome=X|dia=X|hora=X|modalidade=X]` no prompt — SDR coloca no início da resposta quando lead confirma dia + hora
- Parser no `agent.js` extrai a tag, salva no banco e remove do texto antes de enviar ao lead
- Função `notifyOwner()` no `whatsapp.js` envia notificação formatada pra `OWNER_PHONE_NUMBER` (configurado: 5551995304633)
- Aba "📅 Agendamentos" no painel admin com seletor de status
- Ajuste crítico: SDR agora propõe HORÁRIOS ESPECÍFICOS ("terça às 9h ou quarta às 10h") em vez de janelas vagas ("terça de manhã"), pra consultora ter hora exata pra confirmar
- Drill-down binário: se lead vier vago ("manhã"), SDR drilla "tem 9h ou 10h?"
- Migração SQL: ALTER TABLE adiciona scheduled_hour em bancos existentes

**Resultado:** Lead confirma horário → notificação chega no WhatsApp do dono em segundos com nome, telefone, dia, hora, modalidade.

---

## 2026-05-01 — Troca Haiku 4.5 → Sonnet 4.5 (compliance disparou)

**Problema observado:** Mesmo com prompt reorganizado em 4 camadas, Haiku continuava ignorando regras críticas (despejou valores+horários+endereço na 1ª mensagem).

**Diagnóstico honesto (sócio-mode):** Não era falta de memória (estávamos em 7% da janela), era falta de instruction-following capability do Haiku 4.5 com prompt complexo.

**Decisão:** Trocar 1 linha de código (`model:`) e testar. Custo: 30 segundos de trabalho, 3x mais caro por mensagem (~R$0,03 a mais por conversa).

**Resultado dos testes pós-troca:**
- ✅ Teste 1 (1ª mensagem com valor+horário): SDR responde 2 linhas saudação+binária, ZERO despejo de info
- ✅ Teste 2 (lead pede valor → responde sem reinsistir): SDR continua roteiro pedindo nome em vez de pular pra tabela
- ✅ Teste 3 (insistência 3x): SDR libera tabela do mais caro pro mais barato + virada obrigatória pra aula experimental
- ⚠️ Teste 4 (objeção "tá caro" sem ter visto preço): SDR respondeu brilhante ("nem te falei valor ainda haha") mas repetiu mesma binária 3x

**Resultado:** Sonnet resolveu os 3 bugs estruturais. State machine multi-agente foi descartado como overkill.

---

## 2026-05-01 — Restruturação do prompt em 4 camadas (anti "lost in the middle")

**Problema observado:** Prompt cresceu pra 56k chars com regras espalhadas no meio. Haiku ignorava regras inegociáveis.

**Solução arquitetural:**
- Extraído SYSTEM_PROMPT pra `src/prompt.js` separado (era inline em agent.js)
- Estrutura em 4 zonas:
  1. **TOPO BLINDADO** (alta atenção): identidade + 5 regras inegociáveis + antipadrão real do erro + roteiro 5 passos
  2. **PARTE 1-5**: persona, valores, agendamento, técnicas, objeções
  3. **PARTE 6-9**: base de conhecimento (referência) + edge cases
  4. **LEMBRETE FINAL** (alta atenção): 8 checks pro modelo reler antes de responder
- Tamanho: 56k → 38k chars (corte de 32%, ~18k a menos)
- Conteúdo preservado, prosa filosófica redundante removida

**Prompt caching habilitado:**
- `agent.js` agora usa `system: [{cached_static}, {dynamic_context}]`
- Static cacheado por 5min via `cache_control: { type: 'ephemeral' }`
- Dinâmico (audio/time/return/firstMsg) fora do cache
- 90% desconto no input após 1ª mensagem da conversa

---

## 2026-05-01 — Refinamentos comerciais: A/B, contraste, escassez, gírias

**Problema observado:** SDR jumpava pra preço cedo, soava "redação" demais, faltavam técnicas de venda estruturadas.

**5 melhorias adicionadas ao prompt:**

1. **REGRA DOS VALORES endurecida**: gatilho explícito "lead pede de novo, não você achando que sabe o suficiente". Nova regra: lead respondeu mas não reinsistiu → continua roteiro até a visita, NÃO passa valores.

2. **REGRA DAS OPÇÕES — A OU B**: toda decisão é binária. Drill-down binário ("resultado físico" → "ganhar massa ou emagrecer"). Exceções claras pra perguntas abertas (nome, gatilho, investigação).

3. **TÉCNICA DE CONTRASTE DE VALORES**: anchoring (mais caro primeiro), contraste interno entre planos, longo prazo (R$/ano), custo de não treinar, comparação com academia barata.

4. **POSICIONAMENTO DO PLANO CLUBE +**: recomendação natural sempre, jamais insiste. Limite explícito: máximo 1 menção por conversa.

5. **ESCASSEZ DA AULA EXPERIMENTAL**: tom "espaço conquistado, agenda apertada" vs "buffet aberto". 6 frases-modelo do tom certo, 4 do errado.

**+ Espelho de informalidade** (gírias liberadas: cara, véio, mano, blz, kkk, demais, topa, fechou, etc. + regional gaúcha) + **Pontuação WhatsApp** (sem ponto final na última frase) + **Arsenal de técnicas** (Cialdini, loss aversion, assumptive close, decoy, mirroring, hook emocional, reframing, control flip, disarming, micro-commitments).

---

## 2026-04-30 — Persistência SQLite + retorno de lead

**O que foi feito:**
- `better-sqlite3` instalado, módulo `src/db.js` com schema (contacts + messages) e prepared statements
- `src/agent.js` migrado de Map em memória pra DB com camada de normalização camelCase
- `setAudioFlags()` substitui mutação direta no objeto (Map → DB)
- Tag `[LEAD_RETORNANDO_APÓS_X_DIAS]` injetada quando `last_contact_at` > 30 dias
- Webhook.js usa `setAudioFlags` em vez de mutar contact.audioPermission

**Validação:**
- 3 mensagens simuladas → contato + mensagens persistidos
- Server kill + restart → histórico preservado
- Forçar last_contact_at = 35 dias atrás → SDR reconheceu retorno: "Bah, que legal! Então, a gente tava conversando sobre seu objetivo de emagrecer..."

**Resultado:** Memória persistente confirmada, sobrevive a restarts e redeploys.

---

## 2026-04-30 — Deploy 24/7 no Railway com volume persistente

**O que foi feito:**
- GitHub CLI instalado, repositório `stronix-sdr` (privado) criado e código pushed
- Railway CLI instalado, projeto linkado (`practical-balance`)
- Variáveis de ambiente configuradas via CLI (sem subir .env)
- Volume Railway adicionado em `/data` (persistente entre deploys)
- `DB_PATH=/data/database.sqlite` configurado pra usar o volume
- Auto-deploy via push no GitHub funcionando
- URL fixa: `https://stronix-sdr-production.up.railway.app`
- Webhook do Meta atualizado pra apontar pro Railway (sem ngrok)

**Resultado:** Servidor 24/7 sem dependência do Mac do Johnny. URL fixa, sem mais "ngrok mudou de URL".

---

## 2026-04-30 — Token WhatsApp permanente (60 dias)

**Problema:** Token de 24h expirou no meio dos testes. System User token via Business Manager falhou (WhatsApp Account não vinculada à conta).

**Solução:** Graph API Explorer → gerar token de 24h → Token Debugger → estender pra 60 dias. Renovar em julho 2026.

---

## 2026-04-30 — Cérebro completo do SDR consolidado (1ª versão)

**O que foi feito:**
- SYSTEM_PROMPT consolidado em 5 partes (~702 linhas):
  - PARTE 1: BASE DE CONHECIMENTO STRONIX (logística, horários, estrutura, história, modalidades, preços, planos, pagamento, indicação)
  - PARTE 2: REGRAS COMERCIAIS (regra dos valores, persona Johnny, postura, jeito de escrever, emoji, brevity, roteiro qualificação)
  - PARTE 3: OBJEÇÕES (mentalidade, A.V.I.A.R.C., 10+ scripts, reposicionamento, frases de alto nível, follow-up, inativos)
  - PARTE 4: PÚBLICOS ESPECÍFICOS (pós-parto, gestante, idoso, obeso, restrição saúde, adolescente, mulher com medo de ficar musculosa)
  - PARTE 5: CENÁRIOS DE BORDA (grosseiro, "é IA?", quer humano, quer Johnny, número errado, já é aluno, fora horário)
- Tom calibrado (caloroso autêntico, não falso), emoji ~35% das mensagens
- Em-dash banido (prompt + sanitizer no código)
- Função `isOutsideBusinessHours()` com timezone Porto Alegre

---

## 2026-04-30 — Etapa 2 concluída: IA respondendo no WhatsApp

- Integração com Anthropic SDK (Claude Haiku 4.5) no `agent.js`
- Memória de conversa por contato implementada (Map em memória, depois migrada pra SQLite)
- Primeira resposta real de IA recebida no WhatsApp com sucesso

---

## 2026-04-30 — Etapa 1 concluída: fluxo WhatsApp end-to-end

- Meta Cloud API configurada
- ngrok expondo porta 3000 via HTTPS
- Webhook verificado, assinatura `messages` ativa
- Bug de número brasileiro corrigido (wa_id 12 dígitos → 13 com 9º dígito)

---

## 2026-04-30 — Infraestrutura base

- Stack: Meta Cloud API + Node.js + Claude API
- Descartado Baileys/Evolution API por risco de ban
- Express, dotenv, axios, anthropic-sdk, nodemon instalados
- Estrutura src/ com webhook, whatsapp, agent, config, index

---

## 2026-04-29 — Configuração inicial do projeto

- Diretório criado, Git inicializado, .gitignore configurado
- CLAUDE.md + sistema de memória em `memory/` configurados
- Commit inicial
