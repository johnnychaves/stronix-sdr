# Decisões Técnicas e Arquiteturais

Registro de decisões importantes, com contexto e motivação. Consulte antes de propor mudanças de arquitetura.

---

## 2026-04-29 — Sistema de memória baseado em Markdown

**Decisão:** Usar arquivos `.md` versionados em `memory/` como sistema de memória do projeto.

**Por quê:** Permite que o Claude Code leia rapidamente o contexto do projeto sem varrer todo o código. Fica versionado junto com o projeto no Git, preservando o histórico de evolução.

**Alternativas descartadas:** Banco de dados local (overhead desnecessário para documentação), comentários no código (não centraliza o contexto).

---

## 2026-04-29 — .gitignore cobre Node.js e Python

**Decisão:** `.gitignore` configurado para cobrir as duas stacks mais prováveis para um agente de IA/WhatsApp.

**Por quê:** Stack ainda não definida. Cobrir as duas evita commits acidentais de `node_modules/` ou `__pycache__/` independente da escolha final.
