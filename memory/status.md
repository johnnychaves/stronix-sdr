# Status Atual do Projeto

> Última atualização: 2026-05-01

## Estado: SDR em produção, pausado pra teste em campo ✅

O SDR está rodando 24/7 no Railway com Sonnet 4.5. Bugs críticos de compliance resolvidos. Pausado pra observar resultado real antes do próximo ciclo de melhoria.

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
| Google Calendar | 🟡 Média | Criar evento automático no calendar da academia. Hoje a notificação WhatsApp resolve, mas Calendar agrega visibilidade pra equipe. |
| Renovação do token WhatsApp | 🟡 Média | Lembrete: renovar em julho 2026 via Graph API Explorer |
| Upgrade pra número real STRONIX | 🔴 Alta (quando pronto) | Sair do número de teste, verificar conta Business. Após isso, System User token funciona e o número real fica disponível para clientes. |
| ~~Lista de alunos da STRONIX~~ | ✅ Concluído 2026-05-01 | 594 alunos ativos (de 602 contratos, agrupando 8 famílias com phone compartilhado) carregados em produção via bulk endpoint. |
| Cockpit de métricas | 🟢 Baixa | Dashboard: leads, conversões, taxa de agendamento, no-show |
| State machine por stage | 🟢 Baixa | Não necessário com Sonnet 4.5. Reavaliar só se aparecer demanda multi-cliente (SaaS) |

---

## Stack

- **Runtime:** Node.js v24
- **Hosting:** Railway (production) + ngrok local (dev)
- **AI:** Claude Sonnet 4.5 (respostas) + Whisper (transcrição) + ElevenLabs (TTS)
- **DB:** SQLite via better-sqlite3, volume persistente Railway
- **WhatsApp:** Meta Cloud API (oficial)
- **Repo:** github.com/johnnychaves/stronix-sdr (privado)

---

## Para rodar localmente

```bash
cd "AGENTES DE IA/IA para Whatsapp"
node src/index.js       # sobe na porta 3000
# ngrok só se precisar testar webhook local — webhook principal aponta pro Railway
```
