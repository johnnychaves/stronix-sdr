# Status Atual do Projeto

> Atualize este arquivo sempre que o estado do projeto mudar.

## Estado: Infraestrutura base criada ✅

**O que está em pé agora:**
- Repositório Git inicializado (branch `main`)
- Projeto Node.js com `package.json` e dependências instaladas
- Estrutura `src/` criada: `index.js`, `webhook.js`, `whatsapp.js`, `agent.js`, `config.js`
- Servidor Express pronto para receber webhooks do Meta na porta 3000
- ngrok instalado — pronto para expor o servidor localmente
- `.env.example` criado com todas as variáveis necessárias

**Aguardando (ação do usuário):**
- Criar conta e app no Meta for Developers
- Preencher o arquivo `.env` com as credenciais
- Iniciar ngrok e configurar webhook no painel Meta

**Próximos passos de código:**
- Etapa 2: Integrar Claude API no `agent.js`
- Etapa 3: Adicionar memória de conversa por contato
- Etapa 4: Conectar Google Agenda
- Etapa 5: Conectar Google Sheets

---

## Ambiente

| Item | Valor |
|---|---|
| Git | v2.50.1 (Apple Git) |
| SO | macOS (Darwin 25.3.0) |
| Shell | zsh |
| E-mail Git | johnnycbittencourt@gmail.com |
