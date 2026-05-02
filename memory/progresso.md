# Log de Progresso

Registro cronológico de avanços importantes. Adicione entradas no topo (mais recente primeiro).

---

## 2026-05-02 (sessão 2) — Refatoração Johnny v2: Fase 0+1 (PR #32 aberto)

User mandou documento mestre + 5 anexos (núcleo v2, 28 módulos batch1/2/3, engrenagens com schema/parser/roteador/resumo/fluxo). Discussão alinhou 4 decisões + plano de 4 PRs.

### Decisões travadas (com user, em sequência de mensagens):

1. **Tabela `lead_state` separada** de `contacts` (FK pra phone), nunca estender contacts.
2. **Migração:** contatos existentes ganham `lead_state` na 1ª mensagem após deploy v2 (default `estagio_atual=qualificacao_inicial`).
3. **Rollback safety:** `AGENT_VERSION=v1|v2` env var. Default v1 — código v2 deployed mas inativo.
4. **Modelo Roteador (Fase 2):** Haiku 4.5 separado, não tag emitida pelo Johnny.
5. **Roteamento híbrido proposto:** carregamento determinístico (sem Haiku) pra `audio`, `lead_retornando`, `lead_aluno_existente`, `cenarios_borda` fora horário, `objecoes_geral`. Haiku só pra decisão semântica (knowledge factual + escolha de objeção específica).
6. **Cache awareness:** núcleo + KB cacheados; estado/módulos/dyn ctx sem cache (varia turno).
7. **Playground:** user roda Bateria E no PR #32 antes de mergear; Baterias A-D no PR #35 antes do rollout.
8. **Rollout:** SEM ativações intermediárias. Só liberamos pra produção após PR #35 verde com todas baterias passando. Sequência 5% → 25% → 50% → 100% via hash do telefone após aprovação.

### Implementado no PR #32 (Fase 0 + Fase 1):

**Schema (src/db.js):**
- Tabela `lead_state` com 23 campos (estagio_atual, proxima_acao, insistencias_valor, objetivo, modalidade_recomendada, disponibilidade, objecao_ativa, objecoes_levantadas JSON, tentativas_objecao_atual, aula_experimental_agendada, data/hora/modalidade_agendada, primeira/ultima_mensagem_em, total_mensagens_lead/johnny, resumo_dinamico, tags_sistema_ativas JSON, is_aluno_existente, encerrada_em, motivo_encerramento, modulo_pendente, updated_at). FK `contacts.phone`.
- Tabela `prompt_modules` (name PK, title, content, category, active).
- Migrações idempotentes via CREATE IF NOT EXISTS.

**Helpers DB:**
- `getLeadState`, `getOrCreateLeadState`, `updateLeadState` (com validação de enums — valores inválidos ignorados silenciosamente).
- `incrementLeadStateCounter` (insistencias_valor, tentativas_objecao_atual, totais).
- `appendObjecaoLevantada` (histórico cumulativo).
- `resetLeadState` (debug).
- CRUD `prompt_modules` + `seedPromptModulesIfEmpty` (popula no boot).

**Núcleo v2 (src/prompt-nucleo-v2.js):**
- 12.5k chars (vs 38k do v1).
- Identidade + protocolo de tags + máquina de estado (10 estágios) + regra dos valores única + 6 regras de ouro + estilo + blacklist + módulos disponíveis + handoff + anti-padrão + checagem final.

**28 módulos (src/prompt-modules-seed.js):**
- Conhecimento (12): info_academia, modalidades, planos_e_precos, apresentacao_planos, equipe_tecnica, provas_sociais, concorrencia, cancelamento_congelamento, pagamento, indicacao, transferencia_clube, fluxo_aula_experimental.
- Objeções (10): objecoes_geral, objecao_preco/tempo/pensar/adiar/mensal/pagamento/conjuge/distancia/convenio.
- Situacionais (6): publicos_especificos, lead_retornando, lead_aluno_existente, cenarios_borda, audio, tecnicas_persuasao.
- Doc mestre falava 27 (11+10+6); real são 28 (fluxo_aula_experimental veio bonus no batch1 — categorizado como 'sistema'/'conhecimento' dependendo do uso).

**Agent v2 (src/agent-v2.js):**
- `detectsValueRequest(text)`: regex word-boundary + 3 negative patterns. 21 casos de teste passam.
- `parsePipeKV(body)`: extrai `campo=valor|campo=valor`.
- `parseAndStripTags(answer)`: extrai [ESTADO], [MODULO_REQUERIDO], [AGENDAMENTO]. Position-agnostic (case-insensitive). Resiliente: tag malformada não crasha.
- `buildStateBlock(state)`: ~300-500 chars, instrução pra IA usar/respeitar contadores.
- `buildSystemBlocks({state, moduleNames, dynamicCtx})`: 5 camadas em ordem fixa pra cache hit (núcleo cached, KB cached, estado, módulos, dyn ctx).
- `replyV2(from, text)`: pipeline completo (detecta sinais, auto-incrementa, salva user msg, monta prompt, chama Sonnet, parseia, atualiza state, salva resposta).
- `simulateReplyV2(history, message, state)`: versão isolada pro playground, não persiste.

**Webhook toggle (src/webhook.js):**
- `const AGENT_VERSION = (process.env.AGENT_VERSION || 'v1').toLowerCase()`.
- `processBatch` chama `replyV2` se v2, senão `reply` v1. Código v1 100% intocado.

**UI Admin:**
- Aba "Módulos do prompt" (Configurações → Módulos, admin only): 28 cards expansíveis com textarea + Salvar + Ativar/Desativar.
- Endpoints REST: `GET/PUT /api/prompt-modules`, `PATCH /api/prompt-modules/:name/active`, `GET/DELETE /api/lead-state/:phone`.

**Playground v2:**
- Toggle dropdown `v1 | v2`.
- Em v2: dropdown de 21 cenários pré-carregados das Baterias A-E.
- Painel debug lateral mostrando state simulado em tempo real (estagio, insistencias, objecao_ativa, modulo_pendente, etc).
- Endpoint `POST /api/playground/v2/message` que usa `simulateReplyV2`.
- Carregar cenário envia mensagens automaticamente em sequência.

**Tests:**
- `scripts/test-regex-valor.js`: 21/21 passando (10 positivos, 10 negativos, 1 falso positivo aceito conscientemente: "barato é até quem sabe vender").

### O que NÃO foi feito ainda (próximas fases):

**PR #33 — Fase 2: Roteador**
- Função `agent.routeModules(state, tags, isStudent, lastMessage)` chamando Haiku 4.5
- Cache in-memory de roteamento (TTL 5min)
- Fallback: se Johnny pedir `[MODULO_REQUERIDO:X]` que roteador não carregou, marca em `lead_state.modulo_pendente`
- Carregamento determinístico paralelo (sem Haiku) pra: audio, lead_retornando, lead_aluno_existente, cenarios_borda (fora horário)

**PR #34 — Fase 3: Resumo dinâmico**
- Trigger: `total_mensagens > 15`
- Worker via `setImmediate` (não bloqueia resposta)
- Salva em `lead_state.resumo_dinamico`
- Montador usa resumo + últimas 10 msgs quando presente
- Plano B documentado: trocar pra fila SQLite quando passar de 50 resumos/dia ou >2 simultâneos

**PR #35 — Fase 4: Validação e rollout**
- Rodar Baterias A-D + E manualmente via playground
- Dashboard simples (distribuição por estágio, tempo médio até agendamento, taxa handoff)
- Rollout via env var `AGENT_ROLLOUT_PERCENT` + hash do telefone

### Status no fim da sessão:

- ✅ PR #32 aberto e pushed: https://github.com/johnnychaves/stronix-sdr/pull/32
- ⏳ User vai validar Bateria E no playground em outra sessão
- 🔒 Produção SEGURA: AGENT_VERSION default v1, código novo deployed mas inativo

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
