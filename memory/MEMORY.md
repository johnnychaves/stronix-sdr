# MEMORY.md — Índice de Memória do Projeto

Este arquivo é o ponto de entrada do sistema de memória. Leia-o primeiro para ter contexto rápido do projeto sem precisar varrer o código.

## Como usar este sistema

- **Antes de trabalhar:** leia este índice e os arquivos marcados como relevantes para a tarefa
- **Após cada avanço:** atualize o arquivo correspondente com o que funcionou
- **Nunca apague registros antigos** — mova para `arquivo/` se ficarem obsoletos

---

## Arquivos de memória

| Arquivo | Conteúdo |
|---|---|
| [status.md](status.md) | Estado atual do projeto — o que está funcionando agora |
| [decisoes.md](decisoes.md) | Decisões técnicas e arquiteturais tomadas e por quê |
| [progresso.md](progresso.md) | Log cronológico de avanços importantes |
| [o-que-funciona.md](o-que-funciona.md) | Soluções validadas, padrões que deram certo, trechos reutilizáveis |
| [bloqueios.md](bloqueios.md) | Problemas encontrados e como foram resolvidos |

---

## Contexto rápido

- **Projeto:** SDR de IA pelo WhatsApp pra STRONIX Academia (Av. Edgar Pires de Castro, 9392, Lageado, Porto Alegre/RS)
- **Status:** Plataforma feature-complete em produção via **Baileys**. Inclui IA Sonnet 4.5, multi-agente com handoff, painel WhatsApp-style, áudio bidirecional, SSE real-time, knowledge base editável, playground, notificações. **Em curso:** refatoração do Johnny pra arquitetura modular v2 (Fase 0+1 implementada — PR #32 aberto, ainda em validação via Bateria E no playground; AGENT_VERSION=v1 mantém produção intocada). Aguarda também trocar pro número da academia.
- **Stack:** Node.js + Express + Claude Sonnet 4.5 + SQLite + Whisper + ElevenLabs + **Baileys** (com Meta Cloud API ainda disponível como fallback via `WHATSAPP_PROVIDER=meta`)
- **URL produção:** https://stronix-sdr-production.up.railway.app
- **Repo:** github.com/johnnychaves/stronix-sdr (privado)
- **Última atualização:** 2026-05-02 (sessão de refatoração v2 do Johnny — Fase 0+1)

---

## Princípios sócio-mode (acordados com o usuário)

1. **Disagree quando achar que está errado.** O usuário pediu explicitamente que eu o trate como sócio, não como amigo. Discordar quando há evidência ou risco real, não cheerleading.

2. **Trocar 1 linha antes de construir 1 semana de arquitetura.** Quando aparece um problema, o teste mais barato vem primeiro. Trocar modelo (1 linha de código, 30s) antes de state machine (3 dias de código). Validado: trocar Haiku → Sonnet resolveu o que prompt restructure não resolveu.

3. **Single-tenant primeiro, refatora quando aparecer 2º cliente.** Engenharia para SaaS é prematura sem 2º cliente. SQLite > Postgres, monolito > microserviços. Migração futura é 1 dia de trabalho quando aparecer demanda real.

4. **Custo do modelo é irrelevante perto do valor do lead.** Sonnet custa R$0,03 a mais por mensagem. Se converter 1 lead extra de R$149/mês, paga 1 ano da diferença em 1 dia.

5. **Replicar o que funciona em vez de adivinhar.** Validado: a saga do áudio (PRs #5-#11) só foi resolvida quando o usuário lembrou que o TTS já mandava áudio com sucesso há semanas. Bastou copiar o pipeline (MP3 + fetch + ordem de campos) em vez de continuar otimizando opus.

---

## Aprendizados-chave acumulados

1. **Modelos pequenos (Haiku) têm "lost in the middle" forte em prompts >30k chars.** Regras críticas no meio do prompt são ignoradas. Mover pro topo + repetir no fim ajuda, mas trocar pra Sonnet/Opus resolve definitivamente.

2. **Anti-padrão real no prompt > 10 regras abstratas.** Mostrar o exemplo concreto do erro que aconteceu (com resposta certa vs errada) é mais eficaz que reformular regras.

3. **LLM sinaliza estado via tag estruturada > sistema adivinhar via NLP.** O LLM já tem todo o contexto. Tag formatada `[AGENDAMENTO:campo=valor|...]` é zero-ambiguidade, zero chamadas extras.

4. **Prompt caching (cache_control ephemeral) reduz custo dramaticamente.** Em conversa de 10 mensagens, cache hit nas 9 últimas = 90% desconto no input.

5. **Tag dinâmica > regra estática para contexto situacional.** `[FORA_DO_HORÁRIO_COMERCIAL]`, `[LEAD_RETORNANDO_APÓS_X_DIAS]`, `[PRIMEIRO_TURNO]` são injetadas dinamicamente no system message. Mais focadas que ter tudo sempre no prompt.

6. **Sanitização em código complementa instrução do prompt.** Em-dash banido no prompt + regex no código antes de enviar ao usuário = dupla camada que garante mesmo se LLM falhar.

7. **Hora específica no agendamento é não-negociável.** "Terça de manhã" é vago demais — consultora não consegue confirmar nada. Drill binário até hora exata sempre.

8. **Knowledge base separado do prompt cacheado.** Dados que mudam (preço, promo, horário) ficam em tabela editável `academia_info`, injetados no contexto dinâmico. Mudança aparece na próxima resposta da IA sem invalidar cache de 38k chars.

9. **JID resolution via `onWhatsApp` é obrigatório no Baileys BR.** Brasileiros têm contas com 12 ou 13 dígitos (com/sem 9). Mandar pro JID errado = mensagem vai pro vazio sem erro. Sempre resolva antes de enviar.

10. **Canonicalização de phone no DB unifica conversas duplicadas.** `canonicalizeContactPhone(phone)` faz lookup das 2 variações (com/sem 9) antes de gravar. Lead pode mandar como 12-dig e DB ter 13-dig — sistema unifica.

---

## Variáveis de ambiente (Railway)

```
# WhatsApp provider — controla se usa Cloud API oficial ou Baileys
WHATSAPP_PROVIDER=baileys                       # 'meta' ou 'baileys' (default 'meta')

# Meta Cloud API (obrigatórias só se WHATSAPP_PROVIDER=meta)
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_ACCESS_TOKEN=[60 dias]
WEBHOOK_VERIFY_TOKEN=academia-sdr-2026

# Baileys
# (sem credenciais — auth state em volume /data/baileys-auth/)

# IA
ANTHROPIC_API_KEY=sk-ant-api03-...

# Áudio
OPENAI_API_KEY=sk-proj-...                      # Whisper transcrição
ELEVENLABS_API_KEY=sk_...                       # TTS voz clonada
ELEVENLABS_VOICE_ID=RXzNxMfhaT652VGYeS6o

# Storage
DB_PATH=/data/database.sqlite                   # volume Railway

# Notificação WhatsApp pro dono
OWNER_PHONE_NUMBER=5551995304633

# Railway
PORT=[Railway define automaticamente]
```

---

## Estrutura de arquivos (atual)

```
src/
├── index.js              ← entry Express, bootstrap Baileys se PROVIDER=baileys
├── webhook.js            ← HTTP webhook (Meta) + handleIncomingMessage; toggle AGENT_VERSION v1/v2
├── whatsapp.js           ← FACADE — delega pro provider ativo
├── whatsapp-meta.js      ← Meta Cloud API (sendMessage, sendAudio, uploadMedia, transcode)
├── whatsapp-baileys.js   ← Baileys (WebSocket, QR, auth state, JID resolve, status updates)
├── agent.js              ← reply() v1 (PROMPT MONOLÍTICO 38k, ATIVO em produção)
├── agent-v2.js           ← replyV2() + simulateReplyV2() — máquina de estado modular (Fase 0+1)
├── prompt.js             ← SYSTEM_PROMPT v1 (38k chars, cacheado, em uso)
├── prompt-nucleo-v2.js   ← Núcleo v2 (12.5k chars, sem módulos, aguarda Fase 2)
├── prompt-modules-seed.js ← seed dos 28 módulos (carregados no boot do db.js)
├── db.js                 ← SQLite (18 tabelas, helpers, canonicalize phone, kb, lead_state, prompt_modules)
├── auth.js               ← cookie-based session, requireAuth, requireAdmin
├── events.js             ← EventEmitter singleton pro SSE
├── tts.js                ← ElevenLabs voz clonada
├── transcriber.js        ← Whisper (transcribeAudioBuffer provider-agnostic)
├── admin.js              ← painel HTML completo + endpoints REST + SSE + módulos UI + playground v2
└── config.js             ← carrega .env (Meta vars opcionais se Baileys)

scripts/
├── import_students.py    ← importação bulk de alunos do xlsx
└── test-regex-valor.js   ← teste do detector de pedido de valor (21 casos, 21/21 passam)

scripts/
└── import_students.py    ← importação bulk de alunos do xlsx

memory/                   ← este sistema (5 arquivos)
data/                     ← SQLite local (gitignored, em prod no volume)
```

---

## Endpoints HTTP principais

```
GET  /                                       — health check
POST /webhook                                — Meta Cloud API webhook (incoming msg + status)
GET  /webhook                                — Meta verification

GET  /admin                                  — painel HTML
GET  /admin/login                            — tela login
POST /admin/api/auth/login
POST /admin/api/auth/logout
GET  /admin/api/me

# Conversas
GET  /admin/api/conversations
DELETE /admin/api/conversations/:phone
POST /admin/api/conversations/:phone/reply         — texto
POST /admin/api/conversations/:phone/reply-audio   — áudio (base64)
POST /admin/api/conversations/:phone/assume
POST /admin/api/conversations/:phone/release
POST /admin/api/contacts/init                      — modal "nova conversa"

# Real-time
GET  /admin/api/events                       — SSE stream

# Knowledge base
GET  /admin/api/academia-info
PUT  /admin/api/academia-info/:key           — admin only

# Playground
POST /admin/api/playground/message

# WhatsApp / Baileys
GET  /admin/api/whatsapp/status              — { provider, status, qr?, me?, connectedSince? }
POST /admin/api/baileys/disconnect           — admin only
GET  /admin/baileys/qr                       — página HTML standalone (alternativa)

# Mídia
GET  /admin/api/media/:filename              — serve áudio salvo

# Outros
CRUD /admin/api/users                        — admin only
CRUD /admin/api/students
CRUD /admin/api/appointments
PUT  /admin/api/reviews/:phone
GET  /admin/api/metrics                      — admin only

# Agent v2 (Fase 0+1, em validação)
GET  /admin/api/prompt-modules                — lista os 28
GET  /admin/api/prompt-modules/:name          — conteúdo
PUT  /admin/api/prompt-modules/:name          — admin only
PATCH /admin/api/prompt-modules/:name/active  — admin only
GET  /admin/api/lead-state/:phone             — debug
DELETE /admin/api/lead-state/:phone           — admin only (reset)
POST /admin/api/playground/v2/message         — playground v2 (state simulado)
```

---

## Refatoração Johnny v2 — onde parou (2026-05-02)

**Documento mestre + 5 anexos** (núcleo, módulos batch1/2/3, engrenagens) recebidos do user. Todos lidos e implementados na Fase 0+1.

### O que está PRONTO (PR #32, ABERTO, aguardando merge):

- Schema `lead_state` (23 campos, FK contacts) + `prompt_modules` (28 módulos seed)
- Núcleo v2 (12.5k chars) em [src/prompt-nucleo-v2.js](../src/prompt-nucleo-v2.js)
- 28 módulos em [src/prompt-modules-seed.js](../src/prompt-modules-seed.js): 12 conhecimento + 10 objeções + 6 situacionais
- [src/agent-v2.js](../src/agent-v2.js): `replyV2()` + `simulateReplyV2()`
- Parser `[ESTADO]` / `[MODULO_REQUERIDO]` / `[AGENDAMENTO]` (resiliente, position-agnostic)
- Detector regex de pedido de valor (21/21 testes em [scripts/test-regex-valor.js](../scripts/test-regex-valor.js))
- Auto-incremento determinístico backend de contadores (`insistencias_valor`, `tentativas_objecao_atual`)
- Force handoff_humano em 3 tentativas mesma objeção
- Montador de prompt em 5 camadas com cache awareness
- Toggle `AGENT_VERSION=v1|v2` no webhook (default v1 — produção intocada)
- Aba **Módulos do prompt** no admin (admin only) — edita os 28 módulos
- Playground v2 com 21 cenários pré-carregados (Baterias A-E) + painel debug lateral

### Próximos passos (em sequência):

1. **Validação manual** via Bateria E no playground (resp do user antes de mergear)
2. **PR #32 merge** após validação
3. **PR #33 — Fase 2: Roteador** (Haiku 4.5) — carregamento dinâmico dos módulos baseado em estado + tags + última msg
4. **PR #34 — Fase 3: Resumo dinâmico** — background quando >15 msgs
5. **PR #35 — Fase 4: Validação completa** + dashboard + rollout 5% → 25% → 50% → 100% via hash do telefone

### Decisões travadas com user (não mexer sem nova conversa):

- Tabela `lead_state` SEPARADA de `contacts` (FK), nunca estender contacts
- Cache: núcleo (12.5k) + KB cacheados; estado/módulos/dyn ctx SEM cache
- Roteador será Haiku 4.5 separado (Fase 2) — não confundir com tag MODULO_REQUERIDO emitida pelo Johnny no fim (esse é fallback)
- Determinístico SEM Haiku pra: `audio`, `lead_retornando`, `lead_aluno_existente`, `cenarios_borda` (fora horário), `objecoes_geral` (junto com objecao_X)
- Falsos positivos do regex de valor são aceitos conscientemente (custo: incrementa `insistencias_valor` 1x)
- Rollout: NADA em produção até PR #35 verde com TODAS Baterias A-E passando. AGENT_VERSION=v1 default mantido. Rollout depois via hash do telefone (5% → 25% → 50% → 100%) — sem ativações intermediárias.

### Anexos do plano (referência):

Conteúdo completo dos anexos foi incorporado no código:
- Anexo 1 (núcleo) → src/prompt-nucleo-v2.js
- Anexos 2/3/4 (28 módulos) → src/prompt-modules-seed.js
- Anexo 5 (schema/parser/roteador/resumo/fluxo) → src/db.js (schema+helpers) + src/agent-v2.js (parser+montador). Roteador ainda PENDENTE pra Fase 2.
