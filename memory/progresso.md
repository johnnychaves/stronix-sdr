# Log de Progresso

Registro cronológico de avanços importantes. Adicione entradas no topo (mais recente primeiro).

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
