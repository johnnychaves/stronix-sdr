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
