# Bloqueios e Resoluções

Problemas que travaram o desenvolvimento e como foram superados. Consulte antes de gastar tempo com um problema que já foi resolvido.

---

## 2026-05-01 — Haiku 4.5 ignorando regras críticas do prompt

**Sintoma:**
- 1ª mensagem: SDR despejava valores, horários, endereço, todos os planos, fechando com "qual plano faz mais sentido pra você?"
- Lead pedia valor 1x, respondia perguntas, e SDR já jogava a tabela inteira
- Repetia mesma pergunta 3x mesmo após lead responder
- Em-dashs aparecendo mesmo com regra explícita

**Causa raiz:** Não era falta de memória/contexto (estávamos em 7% da janela do Haiku, ~14k de 200k tokens). Era **limitação de instruction-following capability** do Haiku 4.5 com prompt longo (38k chars) e muitas regras simultâneas. Modelos pequenos têm dificuldade em priorizar regras conflitantes em prompts complexos.

**Tentativas que falharam:**
1. Reescrever regras em CAPS — efeito mínimo
2. Adicionar "REGRA INEGOCIÁVEL" — efeito mínimo
3. Adicionar antipadrão real do erro no prompt — efeito moderado
4. Reorganizar prompt em 4 camadas (TOPO BLINDADO no início, LEMBRETE FINAL no fim) — melhorou mas não resolveu

**Solução real:** Trocar 1 linha — `model: 'claude-sonnet-4-5-20250929'` em vez de Haiku. Sonnet com o MESMO prompt obedeceu na 1ª tentativa em todos os 4 cenários de teste.

**Prevenção:** Antes de gastar tempo refinando arquitetura/prompt pra resolver compliance, **testar modelo maior** primeiro. É o teste mais barato (30 segundos, 1 linha de código). Se Sonnet/Opus resolver, problema era o modelo. Se não resolver, aí sim mexer em arquitetura.

**Princípio sócio:** "Não construa state machine multi-agente complexo pra resolver problema que se resolve trocando 1 linha de código."

---

## 2026-05-01 — System User token do Meta não funcionou pra número de teste

**Sintoma:** Tentei criar System User no Business Manager, gerar token permanente. Token retornava 401/permission error ao tentar acessar o WhatsApp Phone Number ID.

**Causa raiz:** A WhatsApp Account de teste do Meta (associada ao app de desenvolvedor) **não pode ser adicionada como ativo** ao System User do Business Manager. O fluxo de System User só funciona quando se tem uma WABA real verificada (com número próprio).

**Solução:** Usar User Access Token de 24h via Graph API Explorer, depois estender pra 60 dias via Token Debugger ("Extend Access Token").

**Prevenção:** Quando STRONIX migrar pro número real (verificado no Meta Business), aí sim System User funciona — a WABA real é vinculável ao Business Manager. Por enquanto (modo teste), renovar token a cada 60 dias.

**Lembrete:** Próxima renovação: julho de 2026.

---

## 2026-05-01 — ngrok URL mudando a cada restart

**Sintoma:** Toda vez que reiniciava o ngrok, a URL HTTPS mudava. Tinha que reconfigurar o webhook no painel do Meta toda vez. Frustrante e não-produtivo.

**Causa raiz:** ngrok free tier não tem URL fixa.

**Solução:** Migrar pro Railway. URL fixa permanente: `https://stronix-sdr-production.up.railway.app`. Auto-deploy via GitHub push. Servidor rodando 24/7 sem depender do Mac estar ligado.

**Prevenção:** Pra projetos que precisam de webhook estável, evitar ngrok grátis. Railway/Render/Fly.io oferecem URL fixa de graça em planos hobby.

---

## 2026-04-30 — Webhook recebia mensagens mas SDR não respondia

**Sintoma:** ngrok inspector mostrava POSTs com 200 OK chegando, mas o lead não recebia resposta nenhuma. Logs do servidor não mostravam nada.

**Causa raiz:** O servidor que tinha sido iniciado pelo agente em background havia ENCERRADO (exit code 143 = SIGTERM). Mas tinha OUTRO node process rodando em segundo plano (iniciado manualmente em outro terminal) que estava processando, e os logs DESSE processo não estavam sendo capturados pelo arquivo de output do background task.

**Solução:** Identificar todos os processos node com `pgrep -a node`, matar todos com `kill $(lsof -ti :3000)`, reiniciar fresh.

**Prevenção:** Sempre verificar `lsof -i :3000` antes de iniciar servidor pra garantir porta livre. Em desenvolvimento, usar nodemon (auto-reload) em vez de subir múltiplos processos manualmente.

---

## 2026-04-30 — Token do WhatsApp expirou no meio dos testes

**Sintoma:** API Meta retornava "Session has expired" ao tentar enviar mensagem. SDR processava, respondia, mas envio falhava.

**Causa raiz:** Token de 24h do Meta App Dashboard tinha expirado. Cada token de teste gerado pelo painel da Meta dura apenas 24h.

**Solução imediata:** Gerar novo token de 24h e atualizar `WHATSAPP_ACCESS_TOKEN` no .env.

**Solução permanente:** Estender pra 60 dias via Token Debugger (developers.facebook.com/tools/debug/accesstoken).

---

## 2026-04-30 — SDR pulava para preço cedo demais

**Sintoma:** Lead pedia valor 1x, respondia 1-2 perguntas de qualificação, e o SDR já despejava os 3 planos.

**Causa raiz:** Regra dos valores no prompt dizia "passe valores na 2ª insistência", mas o SDR interpretava liberalmente. Achava que se o lead respondeu as perguntas, "merecia" os valores.

**Solução:**
1. Endurecer regra com PRINCÍPIO BASE explícito: "o gatilho é o LEAD pedindo de novo, não você achando que ele já sabe o suficiente. Tu não decide quando passar valor, ELE decide quando insistir."
2. Adicionar regra 4 explícita: "lead respondeu mas NÃO repetiu pedido → NÃO passa valores. Continua roteiro até a visita."
3. Antipadrão real do erro como exemplo concreto no prompt.
4. Trocar pra Sonnet 4.5 que obedece muito melhor.

---

## 2026-04-30 — SDR despejava tudo na 1ª mensagem se lead pedia múltiplas coisas

**Sintoma:** Lead diz "valores e horários" → SDR responde com 20+ linhas: 3 planos + horário completo + endereço + estacionamento + "qual plano faz mais sentido?"

**Causa raiz:** Regra "1ª mensagem = 2 linhas, saudação + pergunta" estava no meio do prompt, atenção diluída. Quando lead pedia múltiplas coisas operacionais, SDR caía em modo "FAQ atendendo" e despejava tudo.

**Solução:**
1. Mover a regra pra TOPO BLINDADO (1ª seção do prompt) com peso máximo.
2. Adicionar antipadrão real desse erro específico no prompt.
3. Tag dinâmica `[PRIMEIRO_TURNO]` injetada com instrução de aplicar a regra à risca.
4. LEMBRETE FINAL no fim do prompt repete a regra.
5. Migrar pra Sonnet (resolveu definitivamente).

---

## 2026-04-30 — Anthropic API conta nova bloqueada por revisão

**Sintoma:** Conta nova da Anthropic bloqueada pra uso de API por revisão de segurança.

**Causa raiz:** Anthropic faz revisão automática em contas novas antes de liberar acesso à API.

**Solução:** Esperar liberação (alguns dias) ou usar OpenAI temporariamente.

**Prevenção:** Pedir acesso à API com antecedência. Hoje a conta está liberada e funcionando.

---

## Estrutura de entrada esperada

```
## [Data] — [Descrição do problema]

**Sintoma:** o que estava acontecendo de errado
**Causa raiz:** por que estava acontecendo
**Solução:** o que resolveu
**Prevenção:** como evitar no futuro
```
