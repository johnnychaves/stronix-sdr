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
- **Status:** SDR em produção 24/7 no Railway. Agendamento + Camada 1 de coleta de feedback (review manual no painel) prontos. Aguardando 2 semanas de uso real pra decidir Camada 2.
- **Stack:** Node.js + Express + Claude Sonnet 4.5 + SQLite + Whisper + ElevenLabs + Meta Cloud API
- **URL produção:** https://stronix-sdr-production.up.railway.app
- **Repo:** github.com/johnnychaves/stronix-sdr (privado)
- **Última atualização:** 2026-05-01

---

## Princípios sócio-mode (acordados com o usuário)

1. **Disagree quando achar que está errado.** O usuário pediu explicitamente que eu o trate como sócio, não como amigo. Discordar quando há evidência ou risco real, não cheerleading.

2. **Trocar 1 linha antes de construir 1 semana de arquitetura.** Quando aparece um problema, o teste mais barato vem primeiro. Trocar modelo (1 linha de código, 30s) antes de state machine (3 dias de código). Validado: trocar Haiku → Sonnet resolveu o que prompt restructure não resolveu.

3. **Single-tenant primeiro, refatora quando aparecer 2º cliente.** Engenharia para SaaS é prematura sem 2º cliente. SQLite > Postgres, monolito > microserviços. Migração futura é 1 dia de trabalho quando aparecer demanda real.

4. **Custo do modelo é irrelevante perto do valor do lead.** Sonnet custa R$0,03 a mais por mensagem. Se converter 1 lead extra de R$149/mês, paga 1 ano da diferença em 1 dia.

---

## Aprendizados-chave acumulados

1. **Modelos pequenos (Haiku) têm "lost in the middle" forte em prompts >30k chars.** Regras críticas no meio do prompt são ignoradas. Mover pro topo + repetir no fim ajuda, mas trocar pra Sonnet/Opus resolve definitivamente.

2. **Anti-padrão real no prompt > 10 regras abstratas.** Mostrar o exemplo concreto do erro que aconteceu (com resposta certa vs errada) é mais eficaz que reformular regras.

3. **LLM sinaliza estado via tag estruturada > sistema adivinhar via NLP.** O LLM já tem todo o contexto. Tag formatada `[AGENDAMENTO:campo=valor|...]` é zero-ambiguidade, zero chamadas extras.

4. **Prompt caching (cache_control ephemeral) reduz custo dramaticamente.** Em conversa de 10 mensagens, cache hit nas 9 últimas = 90% desconto no input.

5. **Tag dinâmica > regra estática para contexto situacional.** `[FORA_DO_HORÁRIO_COMERCIAL]`, `[LEAD_RETORNANDO_APÓS_X_DIAS]`, `[PRIMEIRO_TURNO]` são injetadas dinamicamente no system message. Mais focadas que ter tudo sempre no prompt.

6. **Sanitização em código complementa instrução do prompt.** Em-dash banido no prompt + regex no código antes de enviar ao usuário = dupla camada que garante mesmo se LLM falhar.

7. **Hora específica no agendamento é não-negociável.** "Terça de manhã" é vago demais — consultora não consegue confirmar nada. Drill binário até hora exata sempre.

---

## Variáveis de ambiente (Railway)

```
WHATSAPP_PHONE_NUMBER_ID=1074052215792735
WHATSAPP_ACCESS_TOKEN=[60 dias — renovar julho 2026]
WEBHOOK_VERIFY_TOKEN=academia-sdr-2026
ANTHROPIC_API_KEY=sk-ant-api03-...
OPENAI_API_KEY=sk-proj-...                    # Whisper
ELEVENLABS_API_KEY=sk_...
ELEVENLABS_VOICE_ID=RXzNxMfhaT652VGYeS6o
DB_PATH=/data/database.sqlite                  # volume Railway
OWNER_PHONE_NUMBER=5551995304633               # notificação de agendamentos
PORT=[Railway define automaticamente]
```

---

## Estrutura de arquivos

```
src/
├── index.js          ← entry point Express, porta 3000
├── webhook.js        ← recebe POST do Meta, normaliza, chama agent
├── agent.js          ← reply() = brain do SDR + parser de tags
├── prompt.js         ← SYSTEM_PROMPT em 4 camadas (38k chars)
├── db.js             ← SQLite (contacts, messages, appointments)
├── whatsapp.js       ← envio de texto/áudio via Meta + notifyOwner
├── tts.js            ← ElevenLabs voz clonada
├── transcriber.js    ← Whisper transcrição
├── admin.js          ← painel HTML em /admin (3 abas)
└── config.js         ← carrega .env

memory/               ← este sistema
data/                 ← SQLite local (gitignored, em prod fica no volume)
```
