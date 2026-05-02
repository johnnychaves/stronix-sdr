# Decisões Técnicas e Arquiteturais

Registro de decisões importantes, com contexto e motivação. Consulte antes de propor mudanças de arquitetura.

---

## 2026-05-02 — Template padrão de PR (ajustes recorrentes do reviewer viram checklist)

**Decisão:** Sempre que um ajuste solicitado pelo Johnny em review de PR for recorrente (já apareceu em 2+ PRs), promover pra **checklist obrigatória do template de PR** em vez de depender de "lembrar de fazer".

**Por quê:** No PR34, Johnny apontou 2 ajustes esquecidos do PR33 — anexar output da bateria + janela temporal pra métricas. Eu não havia commitado formalmente esses ajustes mas o spírito era válido. Pra não repetir, viro checklist.

**Checklist atual do template de PR (atualizar conforme aparecer):**

1. **PR que roda script de teste/bateria com chamada de LLM** → anexar output em `<details><summary>node scripts/X.js</summary>...</details>` no body. Custo do test run + resultado fixado no histórico daquele PR.
2. **PR que documenta known issue** → definir critérios mensuráveis (% / threshold) E **janela temporal explícita** (N conversas OU N dias). Sem janela, métrica é cosmético.
3. **PR que adiciona toggle/flag** → reafirmar política de default no body ("X continua default mesmo após merge"). Evita drift entre intenção e produção.
4. **PR de fix em prompt LLM** → tentativa máxima de 2 versões (v1 + v2). Se 3ª tentativa não resolver, é limitação intrínseca → documenta como known issue, não insiste.

**Como manter:** essa lista vive aqui em `decisoes.md`. Ao abrir PR novo, conferir se aplica algum item. Item novo → adicionar aqui no mesmo PR (auto-reforço).

**Trade-off aceito:** mais cerimônia por PR, mas zero "esquecimento sistêmico" de prática boa que já foi acordada uma vez.

---

## 2026-05-02 — Roteador de módulos: determinístico (regex) em vez de Haiku 4.5 separado

**Decisão:** Construir o Roteador de módulos da Fase 2 ([src/router-v2.js](src/router-v2.js)) com regras heurísticas determinísticas (estado + 18 keywords regex pt-br + limit 3), sem chamada extra ao Haiku 4.5.

**Por quê:** Princípio sócio "trocar 1 linha antes de construir 1 semana de arquitetura". Haiku adicionaria +300-500ms latência, +$0,001/turno, +1 ponto de falha (rede + LLM stochastic), e exigiria fixtures pra teste. Regex local: <1ms, $0, idempotente, 39 testes unitários offline em sub-100ms.

**Trade-offs aceitos:**
- ⚠️ Cobertura limitada às 39 regras. Lead que escreve "etacionamento" (typo), "qto custa" (abreviação), "tem aquela coisa de academia em casa?" (frase incompleta), ou "tem 💪 musculação?" (emoji no meio) → keyword **não bate** → módulo **não carrega**.
- ⚠️ Zero adaptação semântica. Roteador depende do LLM principal pra estado (`objecao_ativa`).
- ⚠️ Manutenção manual. Cada nova categoria precisa de regra explícita.

**Mitigação:** quando 0 keywords batem, núcleo + KB academia_info ainda carregam (camadas 1+2 sempre). Johnny tem info básica fixa (preços, horários, modalidades). Em prod isso vira respostas mais genéricas — fallback aceitável mas não ideal.

**Plano de evolução condicional:** se rollout 5% mostrar >15% turnos com `routeModules() === []`, abrir **Fase 2.5 — Híbrido**: determinístico cobre o óbvio (zero latência), Haiku roda **só** quando determinístico devolveu `[]`. Custo só pros casos não cobertos. **Não pré-otimizar isso** — não otimiza o que não está medido.

**Implementação:** PR #34. Lógica em camadas (modulo_pendente → estado → keywords) com dedup via Set + limit defensivo MAX_MODULES=3 (evita prompt bloat).

---

## 2026-05-02 — Baileys (WhatsApp Web protocol) em vez de Meta Cloud API

**Decisão:** Migrar WhatsApp transport de Meta Cloud API pra Baileys, com toggle `WHATSAPP_PROVIDER=meta|baileys` mantendo Meta como fallback funcional.

**Por quê:**
- Meta Cloud API tem **janela de 24h**: só pode mandar msg freeform pra contato que respondeu nas últimas 24h. Fora disso, exige template message aprovada (R$ 0,07-0,20 por envio + setup burocrático no Meta Business Manager).
- Pra academia que faz prospecção ativa (reativar aluno antigo, follow-up de lead frio), templates seriam o caminho oficial — mas exigem aprovação prévia, não podem ser dinâmicos.
- Baileys é a lib que serviços brasileiros (JetSales, WaLeads, Z-API, ChatPro) usam por baixo. Funciona como WhatsApp Web — engenharia reversa do protocolo. **Sem janela 24h, sem template, sem cobrança por mensagem.**
- Johnny já operava o WhatsApp pessoal com Baileys há anos sem ban. Conhece o risk profile.

**Trade-offs aceitos:**
- ⚠️ **Risco de banimento** se uso for spam-like. Mitigado: 1 número de academia, comportamento humano (delays 1-3min, msgs únicas), sem disparo em massa.
- ⚠️ **Sem suporte oficial Meta** — quebra ocasional quando WhatsApp atualiza protocolo (Baileys community fix em ~1-3 dias).
- ⚠️ **Sem selo verde de business verificado.**

**Implementação (PR #20):**
- Facade pattern em `src/whatsapp.js` — código que envia/recebe não sabe do provider
- `src/whatsapp-baileys.js` (novo): WebSocket persistente + auth state em `/data/baileys-auth/` + QR endpoint
- `src/whatsapp-meta.js` (renomeado do whatsapp.js antigo): mantido funcional pra fallback
- `src/webhook.js`: extraída `handleIncomingMessage()` chamável por HTTP webhook OU event listener Baileys
- `src/transcriber.js`: `transcribeAudioBuffer()` provider-agnostic
- `src/tts.js`: retorna `{ buffer, mimeType }` em vez de mediaId

**Quando voltar pra Meta:** se acontecer ban repetido OU regulamentação mudar OR um cliente exigir API oficial. Trade-off é aceito enquanto risco for baixo no uso atual.

**Decisão sobre Evolution API vs Baileys puro:** Evolution API é Baileys empacotado em REST + dashboard. Pra nosso caso (1 número, 1 app Node já rodando), Evolution adicionaria complexidade desnecessária (container extra + Postgres + Redis) sem ganho. **Escolhido: Baileys direto, embedded no app.**

---

## 2026-05-02 — Knowledge base separado do prompt cacheado

**Decisão:** Criar tabela `academia_info` (key/value) editável pelo painel, injetada no `dynamicCtx` da IA — separado do `SYSTEM_PROMPT` estático que fica no cache.

**Por quê:**
- Prompt da IA é 38k chars com cache_control ephemeral. Editar prompt invalida o cache (custo pula 10x na próxima conversa).
- Dados que mudam frequentemente (preço de promo, horário, modalidades) NÃO devem estar misturados com regras fixas.
- Editor antigo era textarea de 38k chars — fácil quebrar regra distante quando ia atualizar valor de plano.

**Implementação (PR #30):**
- Tabela `academia_info(key, value, label, description, category, display_order, updated_at)`
- Seed automático com 16 chaves padrão (planos, horários, modalidades, etc)
- `db.buildAcademiaInfoBlock()` monta string formatada das infos preenchidas (vazias não vão pro prompt — controle explícito de "o que a IA sabe")
- `agent.reply()` injeta o bloco no `dynamicCtx` (não cacheado) com instrução "estes valores valem em conflito"
- UI: aba "Conhecimento" agrupa por categoria, save automático no blur

**Resultado:** atualizar valor de plano = editar 1 célula. Próxima resposta da IA já usa o valor novo. Zero risco de quebrar prompt.

---

## 2026-05-02 — SSE em vez de WebSocket pra real-time

**Decisão:** Server-Sent Events (uni-direcional servidor→cliente) em vez de WebSocket bidirecional pra atualizar painel em tempo real.

**Por quê:**
- Casos de uso são todos servidor→cliente (msg nova, status change, conexão caiu). Cliente→servidor já vai por HTTP REST normal.
- SSE é mais simples: HTTP-based, atravessa qualquer proxy, sem lib extra (`EventSource` é nativo do browser), sem heartbeat custom (já tem ping built-in).
- Polling antigo (5s) consumia ~6 GB egress/usuário/mês. SSE consome ~50 MB. Mas a real motivação não foi custo (era irrelevante na escala atual) — foi UX (latência ~100ms vs 3-5s).
- WebSocket adicionaria Socket.io ou similar, lógica de reconexão custom, complexidade pra ganho zero.

**Implementação (PR #27):**
- `src/events.js`: EventEmitter singleton com coalesce de 250ms por phone
- DB hooks emitem em writes (`addMessage`, `updateMessageDeliveryStatus`, etc)
- `/admin/api/events` (SSE): heartbeat 25s, cleanup automático em `req.close`
- Frontend: `EventSource` reconecta sozinho, polling vira fallback de 30s

---

## 2026-05-02 — Pipeline do TTS pra envio de áudio (em vez de opus/ogg "canônico")

**Decisão:** Áudio enviado pelo painel passa pelo MESMO pipeline que o TTS usa há semanas (MP3 + libmp3lame 64k + fetch + ordem de campos `file/type/messaging_product`).

**Por quê:**
Saga de 6 PRs (#5-#11) tentando enviar áudio do painel falhando silenciosamente — Meta API aceitava upload e `/messages` retornava 200 OK mas o lead não recebia.

Tentei nesta ordem:
1. webm direto → silent fail
2. transcode webm→ogg via ffmpeg copy → silent fail
3. opus 64k stereo via libopus → silent fail
4. opus mono 16kHz 32k -application voip ("params canônicos de voice message") → silent fail

User percebeu o óbvio: **a IA já mandava áudio com sucesso há semanas via TTS**. Comparando os caminhos:
| | TTS (funciona) | Manual (falhava) |
|---|---|---|
| Format | audio/mpeg (MP3) | audio/ogg (Opus) |
| HTTP client | fetch + native FormData | axios + FormData |
| Field order | file → type → messaging_product | inverso |

Replicando o pipeline inteiro do TTS, o caminho manual passou a funcionar imediatamente.

**Lição:** quando algo já funciona em produção, **replique o caminho inteiro** em vez de variar pra "o que deveria funcionar segundo docs". A doc da Meta dizia que aceitava ogg/opus, mas na prática o caminho MP3 + fetch + ordem específica é o que entrega.

---

## 2026-05-02 — Dockerfile em vez de Nixpacks

**Decisão:** Usar `Dockerfile` (node:20-slim) em vez do Nixpacks default do Railway pra build.

**Por quê:**
Nixpacks ignorou config de `aptPkgs` e `nixPkgs` no `nixpacks.toml` (PRs #5 e #6 tentaram). Resultado: ffmpeg não instalava, `[server] ⚠️ ffmpeg NÃO encontrado no PATH` no boot.

Switch pra Dockerfile (PR #7) com `apt-get install ffmpeg build-essential python3 ca-certificates` deu controle total e determinístico. Build leva ~3min na primeira vez (apt + native compile do better-sqlite3), mas cache faz builds subsequentes serem rápidos.

**Bonus** (PR #8): mudei `CMD ["npm", "start"]` pra `CMD ["node", "src/index.js"]` direto — npm engole stack traces em alguns casos, dificulta debug.

---

## 2026-05-01 — Inbox multi-agente próprio em vez de ChatPro/Wati

**Decisão:** Construir inbox + handoff IA-humano dentro do painel /admin existente, em vez de migrar pra plataforma SaaS de WhatsApp Business (ChatPro, Wati, Kommo, Z-API).

**Por quê:**
- ChatPro/Wati = R$ 200-500/mês recorrente + obrigaria abandonar a IA customizada (38k de prompt + voz clonada + scripts A.V.I.A.R.C.)
- A IA delas é genérica (GPT-3.5/4o-mini com prompt configurável), produto inferior
- Custo do nosso stack atual: R$ 180-650/mês (Claude + ElevenLabs + Whisper + Railway)
- Pagar AMBOS não fecha conta. Migrar tudo pra ChatPro joga fora 1 mês de trabalho de prompt
- Construir multi-agente próprio: ~10 dias úteis, R$ 0 recorrente extra, mantém o diferencial

**Alternativas descartadas:**
- ChatPro/Wati → analisado acima
- Meta Business Manager Inbox embutido → grátis mas UX ruim (cada consultora cria conta Meta, interface lenta)
- Hybrid (2 números: bot Cloud API + consultoras WhatsApp Business) → fragmenta UX do lead, perde handoff seamless

**Tradeoffs aceitos:**
- ❌ Sem app mobile dedicado (consultora usa o painel pelo browser do celular)
- ❌ Sem mensagens agendadas, broadcast em massa, templates pré-prontos, Kanban visual
- Se algum desses virar crítico, avalia plataforma específica DEPOIS de medir necessidade real

**Arquitetura escolhida:**
- Auth multi-usuário com role admin/consultora (scrypt + cookie httpOnly + sessions em SQLite, sem deps novas)
- Pool aberto: qualquer consultora pode "assumir" qualquer conversa (race protection com UPDATE WHERE NULL)
- Webhook checa `human_assumed_at` antes da IA. Se humano assumiu, IA NÃO roda
- Polling de 5s + Notification API (sem websocket, sem React, sem build)
- Bootstrap UI em vez de senha-padrão hardcoded ou script CLI

---

## 2026-05-01 — Roteamento aluno vs lead determinístico (não NLP)

**Decisão:** Aluno é identificado por phone cadastrado em tabela `students`, NÃO por o SDR detectar via NLP. Se phone está cadastrado, IA não roda — resposta padrão + notifica dono.

**Por quê:** Aluno raramente diz "sou aluno" — manda direto *"que horas começa a aula hoje?"* ou *"posso trocar de plano?"*. SDR sem sinal externo trataria como prospect e ofereceria aula experimental pra quem já paga R\$249/mês. Risco de cancelamento real.

**Alternativas descartadas:**
- Cenário "já é aluno" no prompt (existia) → frágil, depende de NLP
- LLM-classifier antes de responder → custo + latência, ainda dependente de NLP
- IA com prompt "modo aluno" separado → complexidade alta, ainda pode errar respostas operacionais
- Menu URA "Você é aluno (1) ou lead (2)?" → UX de chatbot 2010

**Princípio sócio:** Risco assimétrico. Aluno mal atendido = cancelamento = perda recorrente. Prospect mal atendido = só vai embora. Modelo determinístico tira a IA do caminho onde o erro é mais caro.

**Quando reavaliar:** se aparecer demanda real ("aluno reclamou que demora resposta humana"), aí evolui pra IA modo-aluno (Opção B/C). Por enquanto Opção A é suficiente.

---

## 2026-05-01 — Delay de digitação proporcional ao tamanho da resposta

**Decisão:** Antes de enviar resposta de texto, aguardar `Math.min(3000, Math.max(1000, text.length * 25))` ms ≈ 40 chars/s.

**Por quê:** Resposta de IA chegando instantaneamente em ~3s soa robótica. Adicionar 1-3s simula humano digitando. Proporcional ao tamanho porque "Sim" não pode demorar igual a "tabela completa de planos…".

**Alternativas descartadas:**
- Delay fixo 3s → curto demais pra resposta longa, longo pra "sim"
- Typing indicator da Meta Cloud API → mais bonito mas mais complexo, dois POSTs em vez de um
- Delay no `sendMessage` global → vazaria para `notifyOwner`/`notifyStudent` (notificação tem que sair rápido)

**Implementação:** delay no webhook.js antes do `sendMessage` de resposta. Áudio pulado (TTS já tem latência natural).

---

## 2026-05-01 — Coleta de feedback em camadas (Camada 1 antes de Mixpanel/RAG)

**Decisão:** Construir sistema de avaliação manual de conversas (👍/👎/🚩 + comentário) antes de qualquer ferramenta externa de analytics ou solução técnica pra "esquecimento" do SDR.

**Por quê:** O usuário pediu solução pra "SDR esquecer coisas / lidar com toda objeção". Sem dados reais de produção, qualquer arquitetura (RAG, function calling, state machine, self-critique) é chute caro. Camada 1 dá munição pra atacar problema específico em vez de teórico.

**Arquitetura escolhida (3 camadas):**
1. **Camada 1 (feita):** review manual no painel — botões + comentário, salva em SQLite
2. **Camada 2 (futura):** funil + métricas operacionais — eventos `qualified`, `price_revealed`, `appointment_scheduled`, etc.
3. **Camada 3 (futura):** tracking de custo por lead — input/output/cache tokens da Anthropic API

**Alternativas descartadas (todas pra "depois", se precisar):**
- Mixpanel/Posthog/Amplitude → overkill pra 1 cliente, dado já no SQLite
- Auto-análise diária com LLM → vale só depois de Camada 1 mostrar onde dói
- Grafana/Prometheus → observabilidade industrial pra SDR de 1 academia é piada
- RAG / function calling / self-critique → primeiro identificar QUAL problema real antes de escolher solução

**Princípio sócio:** "Não construa antiesquecimento universal sem ter visto o esquecimento real." Mesma lógica que evitou state machine: trocar Haiku → Sonnet em 1 linha resolveu. Aqui: 2 semanas de marcação manual mostram onde atacar.

---

## 2026-05-01 — Tag-based appointment detection (não NLP/regex)

**Decisão:** SDR coloca tag `[AGENDAMENTO:nome=X|dia=X|hora=X|modalidade=X]` no início da resposta quando lead confirma. Sistema parseia, salva, remove a tag antes de enviar.

**Por quê:** O SDR já tem todo o contexto da conversa. Em vez de tentar adivinhar via NLP "o lead confirmou um horário?", o próprio LLM sinaliza. Zero ambiguidade, zero chamadas extras de API.

**Alternativas descartadas:**
- Regex no código procurando "terça às 9h" → frágil, falsos positivos
- LLM classificador separado (2ª chamada por mensagem) → custo extra, latência extra
- Function calling/tool use → mais complexo de manter, mesmo resultado

---

## 2026-05-01 — Sonnet 4.5 em vez de Haiku 4.5

**Decisão:** Usar `claude-sonnet-4-5-20250929` em vez de Haiku.

**Por quê:** Após 4-5 iterações refinando o prompt pra Haiku, ainda tinha bugs de instruction-following (despejava info, pulava regras). Sonnet com o MESMO prompt obedeceu na 1ª tentativa em todos os 4 cenários de teste. Custo extra: ~3x por mensagem (~R$0,03), insignificante pra o valor de cada lead.

**Alternativas descartadas:**
- Multi-agente por stage → complexidade alta, não fixa o problema raiz (cada agente teria a mesma limitação)
- State machine single-agent → idem
- Claude Opus → 5x mais caro, qualidade marginal melhor pra esse uso
- GPT-4o → menos compliance que Sonnet em testes anteriores
- Gemini 2.5 Pro → não testado, qualidade incerta
- Manter Haiku + extended thinking → caro e com latência

**Princípio:** trocar modelo é o teste mais barato pra problemas de compliance. Antes de gastar 1 semana em arquitetura, gastar 30s trocando 1 linha.

---

## 2026-05-01 — Prompt em 4 camadas (anti "lost in the middle")

**Decisão:** SYSTEM_PROMPT estruturado em TOPO BLINDADO (regras inegociáveis no início) + Regras detalhadas + Base de conhecimento + LEMBRETE FINAL (regras inegociáveis no fim).

**Por quê:** Modelos têm efeito documentado de "lost in the middle" — atenção maior no começo e fim do prompt. Regras críticas no meio se diluem. Repetir as 5 regras essenciais nas duas extremidades ataca isso.

**Resultado:** Tamanho 56k → 38k chars (32% menos). Nenhuma regra perdida.

---

## 2026-05-01 — Prompt caching com cache_control ephemeral

**Decisão:** Separar `system` em 2 blocos: estático (cacheado, ~38k chars) + dinâmico (audio/time/return/firstMsg, sem cache).

**Por quê:** Prompt grande recalculado a cada mensagem é caro. Anthropic oferece cache de 5min com 90% desconto no input. Em conversas com várias mensagens em sequência, isso é dramático.

**Custo:** Cache write é 1.25x do input normal (paga 1x ao escrever). Cache read é 0.1x (90% desconto). Em conversa de 10 mensagens, o break-even é na 2ª mensagem.

---

## 2026-05-01 — Prompt em arquivo separado (`src/prompt.js`)

**Decisão:** Mover SYSTEM_PROMPT pra arquivo dedicado, importado por agent.js.

**Por quê:** 38k chars de string template no agent.js polui o arquivo de lógica. Separação de concerns. Permite editar o prompt sem mexer em código.

**Atenção:** O prompt continua mutável em runtime via admin panel (`updateSystemPrompt`). O arquivo é apenas o DEFAULT na inicialização.

---

## 2026-05-01 — Hora específica obrigatória no agendamento (não janela)

**Decisão:** SDR sempre fecha com hora exata ("terça às 9h"), nunca janela ("terça de manhã"). Drill binário se lead vier vago.

**Por quê:** Consultora não consegue agendar nada com "terça de manhã". Precisa de hora pra confirmar e bloquear na agenda da academia.

**Implementação:**
- Tag exige campo `hora=X`
- Coluna `scheduled_hour` no DB
- Notificação mostra "terça às 9h"

---

## 2026-04-30 — SQLite (better-sqlite3) em vez de Firebase/Postgres

**Decisão:** SQLite com `better-sqlite3` rodando no volume persistente do Railway.

**Por quê:**
- Single-tenant pelos próximos 6 meses (1 cliente: STRONIX). Postgres/Firebase é overkill.
- SQLite é zero-config, super rápido, e backup é só copiar 1 arquivo.
- Volume persistente do Railway garante que dados sobrevivem a deploys.

**Alternativas descartadas:**
- Firebase: cloud-only (não funciona offline), vendor lock-in, async em tudo, queries limitadas (sem JOIN), custo cresce com volume
- Postgres: complexidade desnecessária pra 1 cliente
- DynamoDB: AWS-only, complexidade

**Quando reavaliar:** quando aparecer 2º cliente. Migração SQLite → Postgres é 1 dia de trabalho.

---

## 2026-04-30 — Railway em vez de DigitalOcean/AWS

**Decisão:** Hospedar no Railway.

**Por quê:**
- Setup em 15 minutos (vs ~3h no DigitalOcean)
- Auto-deploy via GitHub: push = deploy
- URL HTTPS fixa de graça (sem ngrok, sem certificado)
- Volume persistente nativo (1-click)
- Custo: ~$5/mês com uso real, plano hobby tem $5 de créditos grátis
- Logs e métricas no painel

**Alternativas descartadas:**
- DigitalOcean Droplet ($4/mês fixo, mais controle, mas precisa configurar Caddy/nginx, PM2, certbot)
- AWS EC2 (overkill, complexidade)
- Render (similar ao Railway, mas Railway tem volumes mais simples)
- Vercel (não suporta long-running server bem)

---

## 2026-04-30 — Token de 60 dias via Graph API Explorer (não System User)

**Decisão:** User Access Token estendido pra 60 dias.

**Por quê:** System User token via Business Manager não funcionou — a WhatsApp Account de teste do Meta não está disponível pra adicionar como ativo (é vinculada direto ao app de desenvolvedor). Fluxo da API Explorer + Token Debugger é o que funciona pra modo teste.

**Quando trocar:** Quando STRONIX migrar pro número real (verificado), aí System User funciona porque a WABA é vinculável ao Business Manager.

**Lembrete:** Renovar em julho de 2026.

---

## 2026-04-30 — Em-dash sanitizer no código (não só prompt)

**Decisão:** Regex `cleanText.replace(/\s*[—–]\s*/g, ', ')` no `agent.js` antes de enviar ao lead.

**Por quê:** Mesmo com a regra "PROIBIDO TRAÇO LONGO" no prompt, Claude às vezes usa. Garantia em código é dupla camada — prompt + post-processing.

---

## 2026-04-29 — Sistema de memória baseado em Markdown

**Decisão:** Usar arquivos `.md` versionados em `memory/` como sistema de memória do projeto.

**Por quê:** Permite que o Claude Code leia rapidamente o contexto sem varrer todo o código. Versionado junto com o projeto, preservando histórico de evolução.

---

## 2026-04-30 — Meta Cloud API em vez de Baileys/Evolution API

**Decisão:** Usar a API oficial do WhatsApp.

**Por quê:** Baileys e Evolution API podem banir o número. Risco inaceitável. Meta Cloud API é gratuita até 1.000 conversas/mês.

---

## 2026-04-30 — Express puro (sem framework adicional)

**Decisão:** Express puro, sem NestJS/Fastify.

**Por quê:** Escopo pequeno (webhook + envio). Frameworks maiores agregam complexidade desnecessária.
