# Log de Progresso

Registro cronológico de avanços importantes. Adicione entradas no topo (mais recente primeiro).

---

## 2026-04-30 — Etapa 2 concluída: IA respondendo no WhatsApp

**O que foi feito:**
- Integração com OpenAI GPT-4o mini no `agent.js`
- Memória de conversa por contato implementada (histórico em Map)
- Primeira resposta real de IA recebida no WhatsApp com sucesso
- Anthropic API bloqueada por revisão de conta nova (conta OpenAI usada como alternativa)
- Quando Anthropic liberar: troca de 1 linha em `agent.js`

**Resultado:** Sistema completo funcionando — mensagem entra, IA pensa, resposta sai no WhatsApp.

---

## 2026-04-30 — Etapa 1 concluída: fluxo WhatsApp end-to-end funcionando

**O que foi feito:**
- Meta Cloud API configurada com app Business no Meta for Developers
- ngrok autenticado e expondo porta 3000 via HTTPS
- Webhook verificado e assinatura de `messages` ativa
- Fluxo testado e validado: celular → Meta → webhook → servidor → resposta → celular
- Corrigido bug de formato de número brasileiro: wa_id tem 12 dígitos, API exige 13 (inserção do 9º dígito na posição correta)

**Resultado:** Infraestrutura 100% funcional. Mensagens chegam e respostas são entregues no celular.

---

## 2026-04-30 — Infraestrutura base do agente

**O que foi feito:**
- Definida stack: Meta Cloud API (oficial) + Node.js + Claude API + Google Agenda/Sheets
- Descartado Baileys/Evolution API por risco de ban em número comercial
- ngrok instalado via brew para expor servidor local ao Meta
- Projeto Node.js inicializado com: `express`, `@anthropic-ai/sdk`, `dotenv`, `axios`, `nodemon`
- Criada estrutura `src/` com 5 arquivos: webhook handler, sender Meta API, agent stub, config, entry point
- Servidor Express na porta 3000 pronto para receber webhooks
- `.env.example` documentando todas as variáveis necessárias
- `npm run dev` inicia com hot-reload via nodemon

**Resultado:** Backend pronto e aguardando credenciais do Meta para primeiro teste end-to-end.

---

## 2026-04-29 — Configuração inicial do projeto

**O que foi feito:**
- Criado diretório do projeto: `IA para Whatsapp/`
- Instalado/confirmado Git v2.50.1 já disponível no sistema
- Inicializado repositório Git com `git init` (branch `main`)
- Criado `CLAUDE.md` com guia para o Claude Code
- Criado `SKILLS.md` com referência de todas as skills disponíveis
- Criado `.gitignore` para Node.js, Python, `.env`, logs, IDEs e segredos
- Commit inicial: `fde7a2b chore: initial project setup`
- Criado sistema de memória em `memory/` com 5 arquivos estruturados
- `CLAUDE.md` atualizado para referenciar o sistema de memória

**Resultado:** Base do projeto configurada e versionada. Pronto para iniciar o desenvolvimento.
