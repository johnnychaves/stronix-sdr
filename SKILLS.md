# SKILLS.md

Skills disponíveis neste projeto para uso com Claude Code.

## Skills Ativos

| Skill | Comando | Descrição |
|---|---|---|
| `init` | `/init` | Inicializa ou atualiza o CLAUDE.md com documentação do projeto |
| `review` | `/review` | Revisa um pull request |
| `security-review` | `/security-review` | Revisão de segurança das mudanças pendentes no branch atual |
| `simplify` | `/simplify` | Revisa código alterado em busca de oportunidades de melhoria e eficiência |
| `schedule` | `/schedule` | Cria tarefas agendadas recorrentes ou únicas executadas por agentes remotos |
| `loop` | `/loop` | Executa um prompt ou slash command em intervalo recorrente |
| `update-config` | `/update-config` | Configura comportamentos automatizados, permissões e variáveis de ambiente no settings.json |
| `claude-api` | — | Build, debug e otimização de apps com a API Claude / Anthropic SDK |
| `fewer-permission-prompts` | `/fewer-permission-prompts` | Reduz prompts de permissão adicionando comandos frequentes ao allowlist |

## Skills de Documentos

| Skill | Comando | Descrição |
|---|---|---|
| `anthropic-skills:pdf` | — | Criar, ler, editar e manipular arquivos PDF |
| `anthropic-skills:docx` | — | Criar, ler, editar documentos Word (.docx) |
| `anthropic-skills:xlsx` | — | Abrir, ler, editar e criar planilhas (.xlsx, .csv, .tsv) |
| `anthropic-skills:pptx` | — | Criar, ler e editar apresentações PowerPoint (.pptx) |

## Skills de Memória e Sessão

| Skill | Comando | Descrição |
|---|---|---|
| `anthropic-skills:consolidate-memory` | — | Consolida arquivos de memória: mescla duplicatas, corrige dados obsoletos |
| `keybindings-help` | — | Personaliza atalhos de teclado no Claude Code |

## Como Usar

Invoque skills diretamente no chat digitando o comando correspondente, por exemplo:

```
/init
/review
/security-review
```

Skills sem comando de barra são acionados automaticamente pelo Claude quando o contexto é adequado (ex.: ao trabalhar com arquivos `.pdf`, `.xlsx`, código da API Anthropic, etc).
