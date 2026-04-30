# Status Atual do Projeto

> Atualize este arquivo sempre que o estado do projeto mudar.

## Estado: Etapa 1 concluída — fluxo end-to-end funcionando ✅

**O que está funcionando agora:**
- Mensagem enviada do celular → chega no servidor via webhook Meta ✅
- Servidor processa e responde de volta para o celular ✅
- Normalização de números BR (wa_id 12 dígitos → 13 com o 9º dígito) ✅
- ngrok expondo servidor local para o Meta via HTTPS ✅
- Meta Cloud API configurada com webhook verificado ✅

**Para rodar localmente:**
1. `node src/index.js` — sobe o servidor na porta 3000
2. `ngrok http 3000` — expõe via HTTPS (URL muda a cada sessão)
3. Atualizar URL do webhook no painel Meta se o ngrok reiniciou

**Próximos passos:**
- Etapa 2: Integrar Claude API no `agent.js` — agente real em vez de eco
- Etapa 3: Memória de conversa por contato
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
