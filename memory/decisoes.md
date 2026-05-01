# Decisões Técnicas e Arquiteturais

Registro de decisões importantes, com contexto e motivação. Consulte antes de propor mudanças de arquitetura.

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
