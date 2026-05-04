# Status Atual do Projeto

> Última atualização: 2026-05-04

## Estado: PR1 do trilho v3 mergeado em modo paralelo. v2 continua default em produção, v3 opt-in.

Maratona de implementação 2026-05-01 → 2026-05-02 entregou a plataforma toda. Em 2026-05-04, PR1 da migração v3 entra: tool use forçado da Anthropic (`responder_ao_lead`) substitui o canal de tags em texto livre. v3 paralelo a v2, opt-in via `AGENT_VERSION=v3`. v2 entra em modo manutenção até PR4 mergear ou v3 ser descartado.

**Trilho v3:**
- ✅ PR1 — Fundação (tool use forçado, single tool atomica, suite 278/278)
- ✅ PR2 — Controle de preço via enum em `planos_referenciados` + retry single-shot (suite 387/387, smoke E2E 2/2 PASS) [bundle: re-aplica canário TOOL_CALL_MULTIPLE perdido no squash do PR1]
- ⏳ PR3 — Monitor v3 + comparação v2 × v3
- ⏳ PR4 (condicional) — Promoção a default se técnica + comercial baterem na janela 50 conv / 14 dias

**Pré-requisito firme antes de qualquer rollout v3:** smoke do dono no playground v3 — 5-10 cenários reais, 60+ min mínimo. Bateria automática não substitui.

---

## Estado das features (todas em produção)

### 🎨 Design (PRs #1, #2, #3, #13, #14, #17, #28)
- Tela login redesenhada (2 colunas com painel da marca)
- App shell com left rail icon-only + Cmd+B pra fixar
- Inbox 3 colunas estilo WhatsApp Web (lista | chat | ficha do lead)
- Bubbles com tail, agrupamento de grupos consecutivos, gradient depth
- Composer redesenhado: [+] [pill com textarea + emoji] [mic|send swap]
- Topbar removida — botão "nova conversa" movido pro header da lista

### 💬 Conversas e atendimento (PRs #18, #19, #25, #26)
- Modal "nova conversa" — busca contato existente OU cria com número novo
- Botão "Mandar msg" em cada aluno cadastrado
- Picker de emoji com 8 categorias + recentes em localStorage
- Player de áudio inline na bubble (MP3 salvo em /data/media)
- Checkmarks ✓ ✓✓ ✓✓ azul (sent/delivered/read via Baileys events)

### ✨ Polish PR (2026-05-03 — frontend-only, sem back-end)
- **Optimistic UI no envio:** bubble aparece instantâneo com ⏱ pulsante, vira ✓ quando o servidor confirma. Em erro vira ⚠ com botão "Tentar de novo". `pendingMessages` Map por phone, merge com history no render.
- **Reply / citar mensagem:** hover em bubble revela ↩, click → preview compacto na composer (com X pra cancelar via Esc), prepend `> trecho\n\n` no texto enviado. Quote renderiza estilizado nas bubbles. WhatsApp do lead vê quote nativo.
- **Quick replies (slash commands):** digita `/` → dropdown abre com snippets, ↑↓ navega, Enter expande, Tab também aceita. 6 defaults seed (`/aula`, `/valores`, `/horario`, `/endereco`, `/agendar`, `/ola`). Aba "Configurações → Atalhos rápidos" pra editar/criar/remover. localStorage por navegador, não sincroniza entre consultoras (aceito como v1).
- **Skeleton loaders + Empty states:** todos os "Carregando..." textuais substituídos por skeleton-card com shimmer animado. Inbox vazia com filtro mostra "Limpar filtro" como ação. Inbox totalmente vazia mostra "Aguardando primeira conversa".

### 📝 Notas internas v2 — sincronizadas (2026-05-03 — backend novo)
PR #39 entregou notas em localStorage no sidebar direito. Redesenhado pra:
- **Toggle 📝 no composer** (ao lado do 😊). Click ativa "modo nota": pill do composer ganha tint amber sutil + indicator "📝 Nota interna — só o time vê" acima. Send envia como nota em vez de mensagem.
- **Bubble inline na conversa** — nota aparece no histórico ordenada por createdAt junto com mensagens, fundo amber escuro, header "📝 Nota interna · Autor". Hover revela ✕ (delete) pro autor ou admin.
- **Sincronizada entre todas consultoras** — tabela `internal_notes` no DB, endpoints REST `POST /internal-notes` + `DELETE /internal-notes/:id`, SSE re-renderiza em tempo real.
- Helper `db.addInternalNote/getInternalNotesByPhone/deleteInternalNote` + `internalNotes: [...]` em `getAllConversations`.

### 🔌 Conexão WhatsApp (PRs #20, #21, #22, #23, #24)
- **Provider toggle** via `WHATSAPP_PROVIDER=meta|baileys`
- Baileys: WebSocket persistente, auth state em `/data/baileys-auth/`
- QR code em `/admin/baileys/qr` ou aba Conexões integrada
- JID resolution via `onWhatsApp` (resolve bug do 9-dígito BR)
- LID resolution (privacy mode WhatsApp Multi-Device)
- `canonicalizeContactPhone` no DB unifica conversas com formatos diferentes

### ⚡ Real-time + notificações (PRs #27, #29)
- SSE em `/admin/api/events` substitui polling 5s (latência ~100ms)
- Banner persistente quando WhatsApp tá fora
- Toast system pra alerts (msg failed, janela 24h, etc)
- Browser notification quando aba em background

### 🧠 Editar e treinar agente (PR #30)
- Knowledge base editável (academia_info — 16 chaves agrupadas em 6 categorias)
- Playground pra simular conversas com IA sem afetar produção
- Custo estimado em R$ por chamada visível no playground

### 🎭 Persona da marca (2026-05-03)
- Aba Configurações → Agente → "🎭 Voz e tom da marca" (admin only)
- 4 slots editáveis sem mexer em estrutura: abertura, gírias quentes, gírias proibidas, frases proibidas extras
- `assembleNucleoV2(persona)` ([src/persona-v2.js](src/persona-v2.js)) faz string-replace dos placeholders no template do núcleo
- DEFAULT_PERSONA mantém comportamento idêntico ao núcleo pré-persona (migração silenciosa)
- Help text com 2 exemplos do que NÃO escrever (regra estrutural / roteiro vão em outros lugares)
- Validação 33/33 offline + smoke E.4 com Anthropic real ($0.02 USD) — bot usou abertura default e parser limpou tags
- Override total via API direta (`agent_config.nucleo_v2`) segue funcionando como emergência

---

## Infraestrutura (100% concluída)

| Item | Status | Detalhe |
|---|---|---|
| Servidor Node.js + Express | ✅ | src/index.js, porta dinâmica Railway |
| Meta Cloud API (webhook) | ✅ | Verificado, campo messages assinado |
| Railway (hosting 24/7) | ✅ | https://stronix-sdr-production.up.railway.app |
| Domínio fixo HTTPS | ✅ | Railway URL permanente, sem ngrok |
| GitHub CI (auto-deploy) | ✅ | Push na main = deploy automático |
| SQLite persistente | ✅ | Volume Railway em /data/database.sqlite |
| Prompt caching Anthropic | ✅ | 90% desconto no input após 1ª mensagem |
| Token WhatsApp 60 dias | ✅ | Renovar ~julho 2026 via Graph API Explorer |

---

## SDR — Cérebro (em campo)

| Item | Status |
|---|---|
| Modelo: Claude Sonnet 4.5 | ✅ |
| Prompt em 4 camadas (TOPO BLINDADO + regras + base + LEMBRETE FINAL) | ✅ |
| 5 Regras Inegociáveis no topo e fim do prompt | ✅ |
| Antipadrão real no prompt (exemplo do erro que não pode repetir) | ✅ |
| Base de conhecimento STRONIX completa | ✅ |
| Roteiro de qualificação 5 etapas com perguntas A ou B | ✅ |
| Regra dos valores — só passa na 3ª insistência | ✅ |
| Virada obrigatória pós-valores pra aula experimental | ✅ |
| Anchoring (preços do mais caro pro mais barato) | ✅ |
| Posicionamento Plano Clube + (recomendação natural) | ✅ |
| Escassez na aula experimental | ✅ |
| Espelho de informalidade + gírias liberadas | ✅ |
| Pontuação estilo WhatsApp (sem ponto final) | ✅ |
| Manual de objeções A.V.I.A.R.C. + 8 scripts | ✅ |
| Arsenal de técnicas de venda (Cialdini, loss aversion, etc.) | ✅ |
| Públicos específicos (pós-parto, idoso, gestante, obeso, etc.) | ✅ |
| Cenários de borda (grosseiro, é IA?, fora de horário, etc.) | ✅ |
| Áudio — espelhamento de meio | ✅ |
| TTS ElevenLabs (voz clonada Johnny) | ✅ |
| Transcrição Whisper (lead manda áudio) | ✅ |
| Memória persistente SQLite (sobrevive restarts e redeploys) | ✅ |
| Lead retornando após 30+ dias (tag + contexto de inativo) | ✅ |
| Sanitização de em-dash no código (garante mesmo se Claude inserir) | ✅ |
| Painel admin — edição de prompt hot-reload | ✅ |
| Painel admin — visualização de conversas | ✅ |

---

## Roteamento Aluno vs Lead + Delay de Digitação (concluído 2026-05-01)

| Item | Status |
|---|---|
| Tabela `students` (phone PK, name, notes, created_at) | ✅ |
| Helpers no db.js: upsertStudent, getStudent, isStudent, getAllStudents, deleteStudent | ✅ |
| Check no webhook ANTES da IA: se phone está em students, IA não roda | ✅ |
| Resposta padrão pro aluno: "Oi {nome}! Aqui é o assistente da academia, mas pra coisas de aluno eu te passo direto pra equipe. Já avisei eles e logo te respondem 👋" | ✅ |
| `notifyStudent` em whatsapp.js — manda WhatsApp pro dono com nome, telefone formatado e preview da mensagem do aluno | ✅ |
| Delay de digitação antes da resposta de texto: `Math.min(3000, Math.max(1000, text.length * 25))` ms | ✅ |
| Áudio sem delay extra (TTS já tem latência natural ~2-3s) | ✅ |
| API REST: GET/PUT/DELETE /admin/api/students com validação de phone | ✅ |
| Aba "🎓 Alunos" no painel: form (phone+nome+notes) + lista + botão remover | ✅ |
| Validação de phone no servidor (mín 10 dígitos) e cliente (mín 12) | ✅ |

**Como usar:** vai em /admin → aba "🎓 Alunos" → cadastra phones dos alunos atuais (formato `5551995304633`). Quando aluno mandar msg, IA responde padrão e te notifica.

**Importação em massa concluída 2026-05-01:** 594 alunos ativos importados a partir do XLSX da STRONIX (`Downloads/clientes-01_05_2026.xlsx`, planilha de 1º de maio com 602 contratos ativos). 8 phones aparecem com 2 clientes ativos cada (família — mãe/filha, irmãos, casal); foram agrupados num único registro com nomes concatenados ("Alana / Sofia"). Endpoint `POST /admin/api/students/bulk` + script `scripts/import_students.py`.

---

## Inbox Multi-agente + Auth (concluído 2026-05-01)

| Item | Status |
|---|---|
| Tabelas `users` (admin/consultora) e `sessions` (token UUID + 7d TTL) | ✅ |
| Colunas `assigned_user_id` + `human_assumed_at` em contacts | ✅ |
| Coluna `sent_by_user_id` em messages (NULL = IA, ID = consultora) | ✅ |
| Hash de senha com scrypt do crypto built-in (sem dep nova) | ✅ |
| Middleware `requireAuth`/`requireAdmin` em src/auth.js | ✅ |
| Cookie httpOnly + sameSite=lax + secure em prod | ✅ |
| Bootstrap UI: 1ª pessoa cria primeiro admin sem senha-padrão hardcoded | ✅ |
| Tela /admin/login com modo bootstrap dinâmico | ✅ |
| Endpoint reply humano com check de assignment | ✅ |
| Endpoint assume com race protection (UPDATE WHERE NULL) | ✅ |
| Endpoint release (devolver pra IA) | ✅ |
| Webhook: check `human_assumed_at` antes da IA + notifyAssignedConsultor | ✅ |
| `notifyAssignedConsultor` envia WhatsApp pra consultora dona ou fallback admins | ✅ |
| Aba Inbox com badges (🤖 IA, 👤 nome consultora, ⭐ minha) + botões assumir/devolver | ✅ |
| Filtros: Todas / IA / Humano / Minhas / Não avaliadas / 👍 / 👎 | ✅ |
| Histórico mostra IA vs humano (cor diferente, nome do atendente) | ✅ |
| Polling 5s na aba Inbox (pausa nas outras) | ✅ |
| Notification API + contador no título (só com aba oculta) | ✅ |
| Aba Usuários (admin only): CRUD + ativar/desativar/reset senha | ✅ |
| Proteção: não desativa nem rebaixa último admin | ✅ |
| Aba Métricas (admin only): conversas/handoff/tempo médio 1ª resposta/por consultora | ✅ |
| 11/11 testes de auth + handoff + roles passando | ✅ |

**Como começar a usar (em produção):**
1. Acessar https://stronix-sdr-production.up.railway.app/admin
2. Criar primeiro admin (Johnny) na tela de bootstrap
3. Login → aba Usuários → adicionar coordenadora, assistente RH (admin) + 2 consultoras
4. Quando lead começar conversa, aparece em Inbox com badge "🤖 IA atendendo"
5. Clicar "Assumir" → IA para de responder, consultora envia mensagens pelo painel
6. Clicar "Devolver pra IA" quando terminar atendimento humano

---

## Sistema de Coleta de Feedback — Camada 1 (concluído 2026-05-01)

| Item | Status |
|---|---|
| Tabela `conversation_reviews` (phone PK, rating, comment, reviewed_at) | ✅ |
| Helpers no db.js: upsertReview, getReview, getAllReviews, deleteReview | ✅ |
| Review embutida em `getAllConversations` | ✅ |
| API: GET/PUT/DELETE /admin/api/reviews — validação de rating + 404 se phone não existe | ✅ |
| UI no painel: botões 👍 Gostei / 👎 Não gostei + textarea comentário com debounce 600ms | ✅ |
| Filtros: Todas / Não avaliadas / 👎 / 👍 + contador | ✅ |
| Badge da avaliação visível no header do card | ✅ |
| Estado aberto preservado entre rerenders (Set por phone) | ✅ |

**Próximo passo:** soltar pra leads reais por 2 semanas, marcar conversas, decidir Camada 2 baseado no que aparecer.

---

## Sistema de Agendamento (concluído 2026-05-01)

| Item | Status |
|---|---|
| Tabela `appointments` no SQLite (phone, name, modality, dia, hora, turno, status) | ✅ |
| Tag `[AGENDAMENTO:nome=X\|dia=X\|hora=X\|modalidade=X]` no prompt | ✅ |
| Parser no agent.js extrai dados, salva, remove tag antes de enviar ao lead | ✅ |
| Notificação WhatsApp pro dono (`OWNER_PHONE_NUMBER=5551995304633`) | ✅ |
| Aba "📅 Agendamentos" no painel admin com seletor de status | ✅ |
| API REST: GET /admin/api/appointments, PATCH /admin/api/appointments/:id | ✅ |
| SDR propõe horários ESPECÍFICOS ("terça às 9h ou quarta às 10h") | ✅ |
| Drill-down binário se lead vier vago ("manhã" → "9h ou 10h?") | ✅ |
| Migração SQL idempotente para coluna scheduled_hour | ✅ |

---

## Pendente — Próximas sessões

| Item | Prioridade | Detalhe |
|---|---|---|
| **Trocar pro número real da academia** | 🔴 Alta (próximo passo) | Hoje rodando no celular pessoal do Johnny pra teste. Quando estável: para o JetSales, abre Conexões → Desconectar → escaneia QR com número da academia. Tudo pronto. |
| ~~AGENT_VERSION fica em v1~~ | ✅ Trocado pra v2 default em 2026-05-03 | Sócio decidiu pular smoke playground + rollout 5%. Default agora é v2, v1 fica como fallback de emergência (Monitor v2 → pausa instantânea + env var). Documentado em [decisoes.md](decisoes.md). |
| ~~Fase 2 — Roteador de módulos~~ | ✅ Concluído PR #34 | [src/router-v2.js](src/router-v2.js) determinístico: estado (estagio + objecao_ativa) + 18 keywords pt-br + limit 3 módulos. 39/39 + 14/14 unit tests passam. Bateria E: 3/5 (cenário EXT_E2 incluso). |
| ~~Fase 3 — Resumo dinâmico~~ | ✅ Concluído PR #36 | [src/resumo-dinamico.js](src/resumo-dinamico.js) Haiku 4.5 fire-and-forget. 10 seções Anexo 5. Sanity check. F.1 ✅ 5/5. Suite offline 100/100. |
| ~~Trilha B — Admin Tooling~~ | ✅ Concluído PR #37 | Aba "🚦 Monitor v2": lista + filtros + detalhe + avaliação 3-níveis + métricas em tempo real + 5 alertas + pausa runtime + force-resumo + export CSV + onboarding tour. 5 conversas seed pra teste pré-prod. 133/133 offline + smoke browser validado. Instrumentação automática alimenta as métricas combinadas no PR33/34. |
| **Smoke manual playground v2** | 🔴 Pré-requisito v2-em-5% | Abrir Configurações → Testar agente → toggle v2. Rodar 5-10 cenários da vida real (lead novo padrão, objeção preço com follow-up, agendamento ponta-a-ponta, gestante, lesão, etc). Confirmar: módulos certos carregam, agendamento captura tag, sem fallbacks frequentes. Bloqueador firme antes de v2 em 5%. |
| **Medição rollout 5% — tag `[ESTADO:]` esquecida** | 🟡 Pré-rollout v2 | **PR37 já instrumenta** automático em `replyV2` quando `parsed.stateFields === null`. Tela Monitor v2 mostra % em tempo real (vermelho se >30%). Janela: **50 conversas reais OU 14 dias corridos**, o que vier primeiro. Critérios: <10% aceita como known issue, 10-20% prioriza Fase 6, >20% abre re-arquitetura com tool use estruturado como Fase 6 prioritária. |
| **Medição rollout 5% — turnos com `routeModules() === []`** | 🟡 Pré-rollout v2 | Mesma janela (50 conversas / 14d). Conta turnos onde Roteador devolveu zero módulos (cobertura insuficiente das 39 regras). Critérios: <5% fallback determinístico vence (mantém arquitetura), 5-15% considera Fase 2.5 (Haiku fallback) na próxima janela, >15% abre Fase 2.5 como prioritária. |
| Templates Meta (fallback opcional) | 🟢 Baixa | Se precisar mandar pra contato fora da janela 24h em modo Meta. Não necessário em Baileys. |
| Fase 3 — Version history do prompt | 🟡 Média | Snapshot a cada save + diff + revert. Ainda não implementado. |
| Fase 4 — Coaching loop | 🟡 Média | Quando 👎 conversa, abrir form "como deveria ter respondido?" → vira few-shot example. |
| Fase 5 — Tone settings (sliders) | 🟢 Baixa | Formal/casual, curto/extenso. Adiciona modificadores no prompt. |
| Fase 6 (potencial) — tool use estruturado | 🟢 Condicional | Migrar tag `[ESTADO:]` no texto pra tool use da Anthropic SDK, eliminando o problema do LLM esquecer tag em respostas longas. Só prioriza se medição do rollout 5% mostrar >10% de tag esquecida. |
| Multi-número | 🟢 Baixa | Hoje 1 número por instalação. Refactor pra rodar academia + marketing em números separados — só se tiver demanda. |
| Google Calendar | 🟡 Média | Criar evento automático no calendar da academia. Hoje a notificação WhatsApp resolve. |
| Renovação do token Meta | 🟡 Média (só relevante se voltar pra Meta) | Token de 60 dias. Em Baileys não é usado. |
| ~~Lista de alunos da STRONIX~~ | ✅ Concluído 2026-05-01 | 594 alunos ativos importados em produção. |
| State machine por stage | 🟢 Baixa | Não necessário com Sonnet 4.5. |

---

## Stack

- **Runtime:** Node.js v20 (Dockerfile node:20-slim) — `Dockerfile` substituiu Nixpacks pra garantir ffmpeg
- **Hosting:** Railway (production)
- **AI:** Claude Sonnet 4.5 (respostas) + Whisper (transcrição) + ElevenLabs (TTS)
- **DB:** SQLite via better-sqlite3, volume `/data/` (database + media + baileys-auth)
- **WhatsApp (atual):** **Baileys** via `@whiskeysockets/baileys` (toggle em `WHATSAPP_PROVIDER`)
- **WhatsApp (fallback):** Meta Cloud API ainda funcional, pode trocar setando `WHATSAPP_PROVIDER=meta`
- **Real-time:** SSE (Server-Sent Events) com EventEmitter singleton
- **Audio transcoding:** ffmpeg (instalado no Dockerfile)
- **Repo:** github.com/johnnychaves/stronix-sdr (privado)

---

## Para rodar localmente

```bash
cd "AGENTES DE IA/IA para Whatsapp"
node src/index.js       # sobe na porta 3000
# ngrok só se precisar testar webhook local — webhook principal aponta pro Railway
```
