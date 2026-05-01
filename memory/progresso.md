# Log de Progresso

Registro cronológico de avanços importantes. Adicione entradas no topo (mais recente primeiro).

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
