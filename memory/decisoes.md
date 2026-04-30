# Decisões Técnicas e Arquiteturais

Registro de decisões importantes, com contexto e motivação. Consulte antes de propor mudanças de arquitetura.

---

## 2026-04-29 — Sistema de memória baseado em Markdown

**Decisão:** Usar arquivos `.md` versionados em `memory/` como sistema de memória do projeto.

**Por quê:** Permite que o Claude Code leia rapidamente o contexto do projeto sem varrer todo o código. Fica versionado junto com o projeto no Git, preservando o histórico de evolução.

**Alternativas descartadas:** Banco de dados local (overhead desnecessário para documentação), comentários no código (não centraliza o contexto).

---

## 2026-04-30 — Meta Cloud API em vez de Baileys/Evolution API

**Decisão:** Usar a API oficial do WhatsApp (Meta Cloud API) como camada de integração.

**Por quê:** Baileys e Evolution API são não-oficiais e podem banir o número permanentemente. Para o WhatsApp comercial da academia, o risco não é aceitável. A Meta Cloud API é gratuita até 1.000 conversas/mês — mais que suficiente.

**Alternativas descartadas:** Baileys (risco de ban), Evolution API (mesmo risco, precisa de Docker), plataformas SaaS como WATI/Respond.io (custo mensal alto).

---

## 2026-04-30 — Express como servidor de webhook (sem framework adicional)

**Decisão:** Usar Express puro, sem NestJS, Fastify ou similares.

**Por quê:** O escopo é pequeno (uma rota de webhook + envio de mensagens). Frameworks maiores adicionam complexidade desnecessária para esse caso.

---

## 2026-04-29 — .gitignore cobre Node.js e Python

**Decisão:** `.gitignore` configurado para cobrir as duas stacks mais prováveis para um agente de IA/WhatsApp.

**Por quê:** Stack ainda não definida. Cobrir as duas evita commits acidentais de `node_modules/` ou `__pycache__/` independente da escolha final.
