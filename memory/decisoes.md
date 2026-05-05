# Decisões Técnicas e Arquiteturais

Registro de decisões importantes, com contexto e motivação. Consulte antes de propor mudanças de arquitetura.

---

## 2026-05-05 — ADDENDUM_V3 como camada anti-lost-in-the-middle + exceção explícita pra preservar estratégia comercial

**Contexto:** Smoke do dono no playground v3 detectou bug "fora de contexto" — lead respondeu pergunta de qualificação, agente apresentou planos com valores inventados + propôs visita na mesma mensagem. Diagnóstico: persona já define o gate ("passa valor SÓ em insistencias_valor=N", default 3) em `buildRegraDosValoresBlock` ([src/persona-v2.js:160](../src/persona-v2.js:160)) — mas a regra vive **dentro do núcleo cacheado de 12k chars**. Lost-in-the-middle: modelo perdeu atenção, ignorou a regra.

**Decisão 1: Reforçar no ADDENDUM_V3 (não no núcleo).** ADDENDUM vai NO FIM do system prompt (após blocos cacheados, antes do dynamic ctx). Posição final do prompt + não-cacheado = atenção máxima do modelo. Pattern já documentado no projeto: regras críticas no TOPO BLINDADO + LEMBRETE FINAL atacam lost-in-the-middle por construção. ADDENDUM é o lugar certo pra reforçar guardas que estão se diluindo no núcleo. Custo extra: ~$0.01/turno (700 → 3.1k chars não-cacheados). Trivial.

**Decisão 2: Documentar a exceção explicitamente em vez de modificar o módulo.** Conflito identificado: módulo `planos_e_precos` ordena `DEPOIS de apresentar: VIRADA OBRIGATÓRIA pra aula experimental` (estratégia comercial deliberada — lead apresentado a valor sem proposta de visita fecha conversa em "vou pensar"). Regra 2 literal "uma ação por turno" quebraria isso.

3 opções consideradas:
- **(A) Documentar exceção no ADDENDUM** — ataca só o sintoma novo (qualificação misturada com apresentação), preserva módulo intacto.
- **(B) Modificar módulo `planos_e_precos`** removendo "VIRADA OBRIGATÓRIA" — alto risco, toca módulo de produção que está performando.
- **(C) Não adicionar regra 2** — evita conflito mas deixa parte do bug aberto (modelo poderia continuar combinando perguntas indevidamente).

**Escolhida: (A).** Princípio sócio-mode aplicado: "trocar 1 linha antes de construir 1 semana de arquitetura". Adicionar texto no addendum > reescrever módulo de produção. Estratégia comercial preservada.

**Por quê é OK ter exceção textual:** o modelo lê o addendum por extenso a cada turno. Exceção explicada com referência ao módulo (`o módulo planos_e_precos define que...`) é mais robusta do que assumir que regra geral "vai funcionar". LLMs lidam bem com regras + exceções nomeadas; mal com regras absolutas que entram em conflito silencioso com outras instruções.

**Validação experimental (smoke real, 2 rodadas, 13/13 PASS):**
- Cenário 4 (bug literal do dono): NÃO reproduziu em nenhuma rodada.
- Cenário 6 (não-regressão da virada): apresentação + virada obrigatória coexistiram em ambas. Validador PR2 aprovou. Estratégia comercial intacta.

**Princípio acumulado:** quando uma regra estrutural (no núcleo cacheado) está sendo ignorada pelo modelo, a primeira tentativa é REFORÇAR no addendum (camada externa não-cacheada com atenção máxima), não REESCREVER o núcleo. Núcleo cacheado é caro de mexer (cache miss + risco de quebrar outras regras). Addendum é barato e cirúrgico.

---

## 2026-05-04 — Migração v3 PR2: controle de preço por construção via enum + retry single-shot

**Decisão:** Adicionar campo `planos_referenciados: array<plano_id>` no input_schema da tool `responder_ao_lead`. Backend cruza valores monetários ≥R$50 na `mensagem_ao_lead` com os preços oficiais dos plano_ids referenciados (±5% tolerance). Se não bater, dispara 1 retry idiomático via `tool_result is_error=true` com hint corretivo + tabela completa de preços. Se segundo retry também falhar, log + envia resposta original (call 1).

**Causa raiz endereçada:** Sonnet às vezes inventava valor de plano fora da tabela oficial em testes do dono (sintoma observado, sem baseline numérico). Detectors do PR37 ([src/v2-detectors.js](../src/v2-detectors.js)) só CONTAM, não bloqueiam. PR2 mata por construção: schema enum força declaração + validação cruzada captura cross-plan confusion (ex: "Pilates Flex R$199" — pilates_flex é R$319; v2 detector aprovava porque 199 está na tabela oficial; v3 reprova porque 199 ≠ pilates_flex).

**Por quê single forced enum em vez de detector regex aprimorado:**
- Detector é POST-FACTO: já gerou a mensagem errada, só conta pra Monitor.
- Enum é CONSTRUTIVO: modelo declara qual plano está citando ANTES de mensagem ir pro lead. Backend valida + corrige via retry.
- Detector não pega cross-plan (R$199 está na tabela mas é musculacao_flex, NÃO pilates_flex). Enum pega.

**Por quê 1 retry máximo (não loop):**
- Aprovado pelo dono explicitamente: "Falhou 2x → loga PRECO_FORA_REFERENCIA e segue com resposta original."
- Loop infinito = risco de custo descontrolado + travar conversa. 1 retry é trade-off entre auto-correção e timeout.
- Custo extra do retry: ~$0.01 USD por turno acionado (cache hit no segundo call). Aceitável.

**Por quê tool_result is_error=true (idioma Anthropic) e não "regenerar do zero":**
- Idioma canônico da Anthropic API. Modelo recebe mensagem de erro estruturada como contexto natural.
- Reusa cache do system prompt + history (não invalida).
- Modelo entende que precisa CORRIGIR (não inventar nova resposta). Hint inclui valores esperados + tabela completa pra reduzir ambiguidade.

**Por quê plano_ids dinâmicos do módulo (não estáticos no código):**
- Source of truth de PREÇO é o módulo `prompt_modules.planos_e_precos` desde PR61. Hardcode no código duplicaria fonte e drift.
- Parser em [src/v3-validators.js](../src/v3-validators.js) `parsePlanosFromModule()` extrai `{plano_id: {price, modalidade, plano_nome}}` da string markdown do módulo.
- Fallback estático `DEFAULT_PLANO_IDS` (10 entries) em [src/v3-tools.js](../src/v3-tools.js) cobre o caso do parser falhar (módulo deletado, formato inválido, etc.) — schema continua válido, validador pula validação (fail-safe).

**Por quê +5% tolerance:**
- Acomoda arredondamento ("199 ≈ 200") + LLM imprecisão.
- Mesma constante usada em v2-detectors.js (`detectsPrecoInventado` linha 42 — `isLikelyDerivation`).
- 5% no R$199 = ±R$10 (177-211). 199 vs 209 ainda passa. Valor "150" cobrado errado dispara.

**Smoke E2E pré-merge confirmou:** com `estagio=apresentacao_planos` + `insistencias_valor=3`, modelo citou 5 valores (R$199, R$99, R$149, R$99, R$109) e declarou correctamente `planos_referenciados=[musculacao_flex, musculacao_no_limit, musculacao_clube, matricula]`. Validador aprovou 5/5. Cache hit no segundo cenário (cache_read=7115 tokens reaproveitado do primeiro).

---

## 2026-05-04 — Migração v3: tool use forçado da Anthropic (PR1 — fundação paralela a v2)

**Decisão:** Construir `replyV3()` paralelo a `replyV2()` ([src/agent-v3.js](../src/agent-v3.js)) usando `tool_choice: { type: "tool", name: "responder_ao_lead", disable_parallel_tool_use: true }` no lugar das tags em texto livre (`[ESTADO:...]`, `[MODULO_REQUERIDO:...]`, etc.). Default código permanece `'v2'`. v3 é opt-in via `AGENT_VERSION=v3` (env Railway) ou override em DB.

**Causa raiz endereçada:** Sonnet esquece a tag `[ESTADO:]` em 60-80% das baterias E.1/E.2_EXT (medido em PR36 × 5 runs). Tag em texto é OPCIONAL pra API — modelo pode esquecer. Tool use forçado é OBRIGATÓRIO por design da Anthropic — modelo não pode terminar a resposta sem chamar a tool.

**Por quê single tool atomica em vez das 3 propostas pelo sócio (`update_lead_state`, `apresentar_planos`, `responder_lead`):**
- Atomicidade: estado novo + mensagem ao lead saem JUNTOS no mesmo input. Impossível ter um sem o outro.
- Latência: single call vs multi-step orquestrado.
- Coerência: schema do `responder_ao_lead` espelha 1-pra-1 o `lead_state` do v2 (mesmos enums, mesmos valores). Mapeamento mecânico.
- 3 tools fariam sentido se houvesse turnos com ações disjuntas (atualizar estado SEM mandar mensagem). Não é o caso aqui — todo turno faz as duas coisas.

**Por quê Sonnet 4.5 mantido (não 4.6) no PR1:**
- Isolar a variável estrutura (tool use) da variável modelo. Se v3 tiver problema, sabemos que é a estrutura, não o modelo novo.
- Sonnet 4.6 fica pra avaliação pós-PR4 em PR dedicado.

**Por quê reusar prompt v2 + addendum curto em vez de reescrever:**
- Prompt v2 de 38k chars está calibrado e validado em produção. Reescrever é alto risco.
- Addendum (~700 chars, [src/v3-tools.js](../src/v3-tools.js) `ADDENDUM_V3`) instrui o modelo a usar a tool e NÃO emitir tags em texto. Reescrita só pós-PR4 com evidência de que o prompt confunde tool use.

**Por quê NÃO tocar agent-v2.js no PR1 (re-implementei `buildDynamicContext` e `isOutsideBusinessHours` em v3):**
- v2 entra em modo manutenção até PR4 mergear ou v3 ser descartado. Decisão do sócio: "só fix de bug crítico" durante a janela de validação v3.
- Re-implementação custou ~25 LOC (DRY violation aceito) — alternativa seria expor mais helpers do v2 (ainda é mudança em arquivo congelado).

**Por quê adicionar event_types `TURN_OK_V3` e `TOOL_CALL_AUSENTE` em [src/db.js](../src/db.js) já no PR1:**
- Necessário pra Monitor (PR3) diferenciar tráfego v2 × v3. Sem isso, `TURN_OK` mistura os dois e perde-se a leitura por versão.
- `TOOL_CALL_AUSENTE` é sanity check: com `tool_choice` forçado, response sem `tool_use` block não deveria acontecer. Se acontecer, log + fallback genérico pro lead. Esperado: 0 ocorrências em produção.

**Pré-requisitos pro rollout v3 (acordado com o sócio):**
1. Smoke do dono no playground v3: 5-10 cenários reais, 60+ min mínimo. **Pré-requisito firme**, sem exceção. Bateria automática não substitui.
2. Bateria E.1/E.2_EXT × 5 runs em v3 com `tag_esquecida=0%` (esperado por design).
3. Critério comercial decisivo na promoção (PR4): taxa de agendamento v3 ≥ taxa v2 na mesma janela. Técnica perfeita não promove se conversão cair.

**Reuso intencional zero-mudança:**
- [src/router-v2.js](../src/router-v2.js) — roteador determinístico (regex), independente de canal de saída
- [src/persona-v2.js](../src/persona-v2.js) — assembleNucleoV2 usado igual no v3
- [src/prompt-nucleo-v2.js](../src/prompt-nucleo-v2.js) — núcleo cacheado idêntico
- [src/resumo-dinamico.js](../src/resumo-dinamico.js) — Haiku 4.5 fire-and-forget continua igual
- [src/v2-detectors.js](../src/v2-detectors.js) — viram defesa em profundidade no v3

---

## 2026-05-03 — Persona da marca: edita TOM via slots, núcleo continua imutável

**Decisão:** Adicionar layer "persona" entre o núcleo (template estrutural) e o prompt final pro Claude. Persona tem 4 slots seguros — `abertura`, `giriasQuentes`, `giriasProibidas`, `frasesProibidasExtra` — substituídos via placeholder no template ([src/prompt-nucleo-v2.js](../src/prompt-nucleo-v2.js)) por `assembleNucleoV2(persona)` em [src/persona-v2.js](../src/persona-v2.js).

**Contexto:** PR #52 expôs textarea do núcleo inteiro na aba Agente. PR #53 removeu porque admin podia quebrar a IA editando estrutura. Persona é o meio-termo: ajusta TOM (gírias, abertura, frases) sem expor regras estruturais.

**Por quê não fazer "append no fim do núcleo":**
- Cria duas listas conflitantes (núcleo tem gírias proibidas + admin adiciona mais embaixo)
- LLM fica confuso sobre qual seguir
- Substituição via placeholder mantém SOURCE OF TRUTH único

**Por quê não fazer "tabela separada de tone settings":**
- Persona está estruturalmente acoplada ao núcleo (gírias proibidas faz parte da seção ESTILO WHATSAPP)
- Tabela separada exigiria contrato adicional (qual aplica primeiro? qual sobrescreve?)
- Single key `agent_config.persona` (JSON) preserva o pattern já existente

**Por quê não usar tool use estruturado pra "voz da marca":**
- Persona é propriedade GLOBAL do agente (não é decisão por turno)
- Tool use seria overkill — string replace é zero-latência

**Por quê DEFAULT_PERSONA mantém comportamento idêntico ao núcleo pré-persona:**
- Migração silenciosa — admin não precisa fazer nada, sistema continua igual
- `assembleNucleoV2(DEFAULT_PERSONA) === núcleo_pre_persona_inteiro` (validado por testes 33/33)
- Persona vira opt-in incremental conforme admin descobre o que ajustar

**Limitação aceita: prompt cache invalida ao mudar persona**
- Cache do Anthropic é por hash do bloco. Mudar persona = novo hash = miss no cache na 1ª chamada pós-edição.
- Mudanças raras (admin edita uma vez, sistema usa por dias). Custo aceitável vs. complexidade de cachear persona separado.

**Override total via API direta segue funcionando** (`agent_config.nucleo_v2`). Bypassa persona. UI não expõe — é só pra emergência via curl. `getNucleoV2()` em [src/agent-v2.js:32](../src/agent-v2.js:32) ramifica explicitamente: se override total existe, usa direto.

**3 pontos pré-merge confirmados pelo sócio:**
1. **Help text com exemplos negativos** — UI tem box amarelo com 2 exemplos concretos do que NÃO escrever em persona ("Sempre passa o valor" → regra estrutural; "Se lead pedir aula, oferece terça" → roteiro). Educa quem editar.
2. **Smoke pré-merge** — [scripts/smoke-persona-e4.js](../scripts/smoke-persona-e4.js) chama Anthropic real com `assembleNucleoV2(DEFAULT_PERSONA)` rodando E.4. Pass com bot usando abertura default + parser limpo. $0.02 USD.
3. **Paridade reply/simulate** — ambos chamam `buildSystemBlocks` → `getNucleoV2()` na mesma linha 199. Sem fork.

**Próximos passos potenciais (não fazer agora):**
- Diff visual entre persona atual vs default (mostra o que o admin mudou)
- Snapshot de personas históricas (revert)
- Multi-persona por horário/canal — só se aparecer pedido real

---

## 2026-05-03 — AGENT_VERSION default vira v2 (v1 fica como fallback de emergência)

**Decisão:** Trocar o default de `AGENT_VERSION_ENV` de `'v1'` pra `'v2'` em [src/webhook.js](src/webhook.js). Pular o caminho original de "smoke playground → 5% rollout → janela 50/14d → 100%". Manter v1 no código como fallback acionável via Monitor v2 (admin pausa instantâneo via DB flag) e via env var `AGENT_VERSION=v1`.

**Por quê o sócio decidiu pular o caminho conservador:**
- Polish PR + features de UX (#39-#49) entregues e estáveis em produção
- Ele quer parar de manter v1 ativo + os 38k chars do prompt monolítico em sincronia com knowledge base / módulos / lead_state do v2
- Aceitou conscientemente os riscos conhecidos do v2 documentados na memory:
  - Bateria E variando 3-5/6 (variabilidade Sonnet em respostas com objecao_ativa)
  - Tag `[ESTADO:]` esquecida em respostas longas (estimado 10-20%)
  - `routeModules() === []` em casos não cobertos pelas 39 keywords (estimado <15%)

**Por quê eu (Claude) discordei brevemente antes de executar:**
- Memory documenta smoke playground como "pré-requisito firme"
- Os 3 bugs do v2 acima podem afetar conversas de leads reais imediatamente
- Caminho rollout 5% mediria isso com baixo risco

Sócio respondeu: caminho B (v2 default + v1 como fallback) — meio-termo entre rip-the-band-aid e rollout faseado. Aceito.

**Implementação:**
- [src/webhook.js](src/webhook.js): `AGENT_VERSION_ENV = process.env.AGENT_VERSION || 'v2'` (era `'v1'`)
- [src/admin.js](src/admin.js): playground default `<option value="v2" selected>` (era v1 selected)
- [src/agent-v2.js](src/agent-v2.js): captura de nome via `parsed.nameFromTag` agora emite `events.emitLeadsChanged()` pra atualizar a aba Leads em tempo real (consistência com v1)
- v1 (`src/agent.js`, `src/prompt.js`) **mantido intacto** como fallback

**Plano de rollback se v2 quebrar em prod:**
1. **Imediato (sem restart):** abrir Monitor v2 → "⏸ Pausar v2 imediatamente". Backend lê DB flag a cada request, vira v1 instantâneo.
2. **Permanente:** setar `AGENT_VERSION=v1` no Railway. Override volta pro env-baseline.
3. **Definitivo:** revert do commit do PR.

**Métricas a acompanhar nos próximos 14 dias:**
- % conversas com tag `[ESTADO:]` esquecida (v2_metrics_log captura como `tag_esquecida`)
- % turnos com `routeModules() === []` (captura como `router_empty`)
- Reviews 👎 vs 👍 nas conversas reais
- Crashes em `replyV2` (capturado como `crash` no Monitor v2)

**Quando deletar v1 de vez:** se 14 dias com v2 em prod sem incidente E métricas dentro dos thresholds (tag <10%, router_empty <5%), abrir PR removendo `src/agent.js`, `src/prompt.js`, e o toggle do webhook. Por enquanto fica como rede de proteção.

---

## 2026-05-03 — Notas internas migram de localStorage pra backend sincronizado

**Decisão:** PR #39 (polish) entregou notas internas como textarea no sidebar direito + localStorage por navegador. 1 dia depois, pivô pra backend sincronizado: tabela `internal_notes`, endpoints REST, render inline na conversa como bubble, toggle 📝 no composer.

**Por quê migrei tão cedo:**
- Sócio percebeu na hora que limitação de localStorage matava o caso de uso real: time precisa **ver contexto coletivo** do lead. "Johnny ligou 18h ontem", "esposa do lado quando atendeu", "comprou semestral em 2024" — esse contexto serve a todas as consultoras, não só quem digitou.
- Mover o textarea pro **fluxo do composer** (não pro sidebar) reduz fricção: anotação fica no caminho natural, não num canto fora do contexto.
- Render inline na conversa (em vez de "ficha do lead") faz a nota aparecer no momento certo da timeline, perto da mensagem que motivou a anotação. Contexto inline > ficha estática.

**Por quê não fiz já no PR #39:**
- PR #39 era polish frontend-only, escopo deliberadamente fechado. Sócio explicitou "sem alterar o back-end".
- Migração via dia seguinte permitiu medir o que precisa do esforço extra (sync entre consultoras) antes de gastar.

**Implementação ([src/db.js](src/db.js) + [src/admin.js](src/admin.js)):**

Backend:
- Tabela `internal_notes(id, phone, user_id, content, created_at)` + index em `(phone, created_at)`
- Helpers: `addInternalNote`, `getInternalNotesByPhone`, `deleteInternalNote(id, userId, isAdmin)`
- Permissão: autor ou admin pode apagar
- `getAllConversations` retorna `internalNotes: [...]` em cada conversa (sem chamada extra)
- Endpoints `POST /admin/api/conversations/:phone/internal-notes` + `DELETE /admin/api/internal-notes/:id`
- Emite `events.emitConversationChanged(phone)` pra SSE re-renderizar

Frontend:
- Removida section da sidebar direita + helpers `loadInternalNote/saveInternalNote/onInternalNoteChange/NOTES_STORAGE_PREFIX`. localStorage existente fica órfão (raro, feature ainda não divulgada)
- Estado `noteModeActive` global. Toggle 📝 no `chat-input-pill` ao lado do 😊
- CSS: `.chat-input-pill.note-mode` com tint amber + `.note-mode-indicator` acima
- `sendChatReply` redireciona pra `sendInternalNote(phone, text)` quando `noteModeActive`
- Optimistic UI: pending bubble com flag `isNote: true` + render como bubble note dim
- Render: `getMergedHistory` agora junta `c.history + c.internalNotes + pending`, ordenado por `createdAt`. Bubble especial centralizada com header "📝 Nota interna · Autor", fundo amber dark
- Delete via hover ✕ (autor/admin) → confirm → DELETE → loadConversations
- `messagesStamp` inclui count + last createdAt das notas pra forçar re-render via SSE quando outra consultora adiciona

**Trade-offs aceitos:**
- ⚠️ Hard delete (não soft). Notas raras precisam recuperar; se virar pedido, vira `deleted_at` flag.
- ⚠️ Sem edição. Errou? Apaga e cria nova. Edit complica permission model.
- ⚠️ Limit 2000 chars (server-side). Mais que isso vira documento, não nota.
- ⚠️ Sem markdown. Texto puro com auto-linkify de URLs.
- ⚠️ Notas órfãs em localStorage do PR #39: ignoradas. Documentado no commit message.

**Princípio sócio aplicado:** "Single source of truth no DB, render derivado." Nota não duplica em messages — vive em tabela própria, frontend merge por timestamp pro render.

---

## 2026-05-02 — Resumo dinâmico via Haiku 4.5 em background (Fase 3, PR #36)

**Decisão:** Conversas longas (≥20 msgs) usam (resumo estruturado + msgs novas) em vez de 50 msgs cheias no prompt. Resumo gerado por **Haiku 4.5** em **fire-and-forget após responder** ao lead. Threshold de 20 msgs pra primeiro resumo + update incremental a cada 10 msgs novas.

**Por quê Haiku (não Sonnet):**
- Tarefa é sumarização estruturada com formato fixo (6 seções markdown). Não exige criatividade nem instruction-following complexo. Caso ideal pra modelo menor.
- Custo: ~$0,001/update (Haiku) vs ~$0,01/turn (Sonnet) = 10x menos.
- Latência: ~500ms (Haiku) — irrelevante porque roda em background.
- Conversa de 50 msgs = ~3 updates (1 inicial + 2 incrementais) ≈ $0,003 total. Comparado a $0,15 pelo prompt bloat sem resumo, paga sozinho.

**Por quê background fire-and-forget (não inline):**
- Inline antes de responder = +500ms na latência percebida pelo lead. Inaceitável.
- Inline depois de responder mas antes de retornar = mesma latência (cliente espera).
- Fire-and-forget = zero impacto na resposta atual. Próximo turno usa resumo atualizado.
- Trade-off: race condition possível se 2 mensagens chegam em <500ms (raro em WhatsApp humano). Mitigação: já temos buffer de debounce de 15s no webhook (de 2026-05-01) que naturalmente serializa.

**Por quê threshold 20 msgs / update a cada 10:**
- 20 msgs = 10 turnos. Antes disso, histórico cabe sem custo significativo.
- Update a cada 10 = balanço entre desatualização do resumo (alto N = pior) e custo (baixo N = pior). 10 dá ~3-5 updates em conversa de 50 msgs.

**Por quê markdown texto (não JSON):**
- JSON exige tool use ou prompt mais rígido — Haiku às vezes quebra formatação.
- Texto markdown com 6 seções fixas (LEAD/OBJETIVO/PONTOS CHAVE/OBJEÇÕES TRATADAS/PENDENTE/TOM) é mais resiliente. Bot lê como contexto narrativo.
- Sanity check: cap em MAX_RESUMO_CHARS=2000 (~500 chars típico).

**Trade-offs aceitos:**
- ⚠️ Resumo pode estar levemente desatualizado (até 10 msgs atrás). Bot lê últimas N msgs cruas em paralelo — cobre o gap.
- ⚠️ Se Haiku retornar lixo/inventar, próxima resposta pode ser pior. Mitigação: prompt do Haiku diz "NÃO INVENTE" + cap de chars + sanity check de transcript >50 chars.
- ⚠️ Se processo node morre antes do background terminar (raro em Railway), resumo se perde mas dados originais ficam em messages. Próxima request reativa o trigger.

**Implementação:** PR #36. Lógica em `src/resumo-dinamico.js` (~140 linhas). Camada 4.5 no `buildSystemBlocks` (entre módulos e dynamic ctx, sem cache). Refactor pós-review (commit `83a313d`): prompt expandido pra **10 seções estruturadas** do Anexo 5 + `validateResumoSchema` regex pra rejeitar retorno malformado do Haiku + 6 docs do plano copiados pra `docs/refactoring/`.

**Plano de evolução condicional:** se resumo gerado piorar conversas (medível via review humano dos primeiros 50 leads em rollout 5%), revisar prompt do Haiku ou trocar pra Sonnet 4.5 (custo subiria pra ~$0,01/update — ainda barato).

---

## 2026-05-02 — Template padrão de PR (ajustes recorrentes do reviewer viram checklist)

**Decisão:** Sempre que um ajuste solicitado pelo Johnny em review de PR for recorrente (já apareceu em 2+ PRs), promover pra **checklist obrigatória do template de PR** em vez de depender de "lembrar de fazer".

**Por quê:** No PR34, Johnny apontou 2 ajustes esquecidos do PR33 — anexar output da bateria + janela temporal pra métricas. Eu não havia commitado formalmente esses ajustes mas o spírito era válido. Pra não repetir, viro checklist. No PR36, mesmo padrão repetiu — Johnny pediu doc mestre no repo (estava fora) e validação multi-run da bateria (1 run não comprova variabilidade vs regressão). Adicionados como itens 5 e 6.

**Checklist atual do template de PR (atualizar conforme aparecer):**

1. **PR que roda script de teste/bateria com chamada de LLM** → anexar output em `<details><summary>node scripts/X.js</summary>...</details>` no body. Custo do test run + resultado fixado no histórico daquele PR.
2. **PR que documenta known issue** → definir critérios mensuráveis (% / threshold) E **janela temporal explícita** (N conversas OU N dias). Sem janela, métrica é cosmético.
3. **PR que adiciona toggle/flag** → reafirmar política de default no body ("X continua default mesmo após merge"). Evita drift entre intenção e produção.
4. **PR de fix em prompt LLM** → tentativa máxima de 2 versões (v1 + v2). Se 3ª tentativa não resolver, é limitação intrínseca → documenta como known issue, não insiste.
5. **PR que implementa fase do plano de refatoração** → se referência (anexo, doc mestre) NÃO está no repo, ação 1 do PR é copiar pra `docs/refactoring/`. Decisão de design sem fonte versionada vira ambíguo em review futuro.
6. **PR com regressão de testes (mesmo que aparente "variabilidade do LLM")** → rodar bateria 5x antes de aceitar como variabilidade. 1 run é hipótese, 5 runs com mesmo código é dado. Distribuição oscilante (ex: 3-5) confirma. Distribuição constante revela bug real.

**Como manter:** essa lista vive aqui em `decisoes.md`. Ao abrir PR novo, conferir se aplica algum item. Item novo → adicionar aqui no mesmo PR (auto-reforço).

**Trade-off aceito:** mais cerimônia por PR, mas zero "esquecimento sistêmico" de prática boa que já foi acordada uma vez.

---

## 2026-05-02 — Roteador de módulos: determinístico (regex) em vez de Haiku 4.5 separado

**Decisão:** Construir o Roteador de módulos da Fase 2 ([src/router-v2.js](src/router-v2.js)) com regras heurísticas determinísticas (estado + 18 keywords regex pt-br + limit 3), sem chamada extra ao Haiku 4.5.

**Por quê:** Princípio sócio "trocar 1 linha antes de construir 1 semana de arquitetura". Haiku adicionaria +300-500ms latência, +$0,001/turno, +1 ponto de falha (rede + LLM stochastic), e exigiria fixtures pra teste. Regex local: <1ms, $0, idempotente, 39 testes unitários offline em sub-100ms.

**Trade-offs aceitos:**
- ⚠️ Cobertura limitada às 39 regras. Lead que escreve "etacionamento" (typo), "qto custa" (abreviação), "tem aquela coisa de academia em casa?" (frase incompleta), ou "tem 💪 musculação?" (emoji no meio) → keyword **não bate** → módulo **não carrega**.
- ⚠️ Zero adaptação semântica. Roteador depende do LLM principal pra estado (`objecao_ativa`).
- ⚠️ Manutenção manual. Cada nova categoria precisa de regra explícita.

**Mitigação:** quando 0 keywords batem, núcleo + KB academia_info ainda carregam (camadas 1+2 sempre). Johnny tem info básica fixa (preços, horários, modalidades). Em prod isso vira respostas mais genéricas — fallback aceitável mas não ideal.

**Plano de evolução condicional:** se rollout 5% mostrar >15% turnos com `routeModules() === []`, abrir **Fase 2.5 — Híbrido**: determinístico cobre o óbvio (zero latência), Haiku roda **só** quando determinístico devolveu `[]`. Custo só pros casos não cobertos. **Não pré-otimizar isso** — não otimiza o que não está medido.

**Implementação:** PR #34. Lógica em camadas (modulo_pendente → estado → keywords) com dedup via Set + limit defensivo MAX_MODULES=3 (evita prompt bloat).

---

## 2026-05-02 — Baileys (WhatsApp Web protocol) em vez de Meta Cloud API

**Decisão:** Migrar WhatsApp transport de Meta Cloud API pra Baileys, com toggle `WHATSAPP_PROVIDER=meta|baileys` mantendo Meta como fallback funcional.

**Por quê:**
- Meta Cloud API tem **janela de 24h**: só pode mandar msg freeform pra contato que respondeu nas últimas 24h. Fora disso, exige template message aprovada (R$ 0,07-0,20 por envio + setup burocrático no Meta Business Manager).
- Pra academia que faz prospecção ativa (reativar aluno antigo, follow-up de lead frio), templates seriam o caminho oficial — mas exigem aprovação prévia, não podem ser dinâmicos.
- Baileys é a lib que serviços brasileiros (JetSales, WaLeads, Z-API, ChatPro) usam por baixo. Funciona como WhatsApp Web — engenharia reversa do protocolo. **Sem janela 24h, sem template, sem cobrança por mensagem.**
- Johnny já operava o WhatsApp pessoal com Baileys há anos sem ban. Conhece o risk profile.

**Trade-offs aceitos:**
- ⚠️ **Risco de banimento** se uso for spam-like. Mitigado: 1 número de academia, comportamento humano (delays 1-3min, msgs únicas), sem disparo em massa.
- ⚠️ **Sem suporte oficial Meta** — quebra ocasional quando WhatsApp atualiza protocolo (Baileys community fix em ~1-3 dias).
- ⚠️ **Sem selo verde de business verificado.**

**Implementação (PR #20):**
- Facade pattern em `src/whatsapp.js` — código que envia/recebe não sabe do provider
- `src/whatsapp-baileys.js` (novo): WebSocket persistente + auth state em `/data/baileys-auth/` + QR endpoint
- `src/whatsapp-meta.js` (renomeado do whatsapp.js antigo): mantido funcional pra fallback
- `src/webhook.js`: extraída `handleIncomingMessage()` chamável por HTTP webhook OU event listener Baileys
- `src/transcriber.js`: `transcribeAudioBuffer()` provider-agnostic
- `src/tts.js`: retorna `{ buffer, mimeType }` em vez de mediaId

**Quando voltar pra Meta:** se acontecer ban repetido OU regulamentação mudar OR um cliente exigir API oficial. Trade-off é aceito enquanto risco for baixo no uso atual.

**Decisão sobre Evolution API vs Baileys puro:** Evolution API é Baileys empacotado em REST + dashboard. Pra nosso caso (1 número, 1 app Node já rodando), Evolution adicionaria complexidade desnecessária (container extra + Postgres + Redis) sem ganho. **Escolhido: Baileys direto, embedded no app.**

---

## 2026-05-02 — Knowledge base separado do prompt cacheado

**Decisão:** Criar tabela `academia_info` (key/value) editável pelo painel, injetada no `dynamicCtx` da IA — separado do `SYSTEM_PROMPT` estático que fica no cache.

**Por quê:**
- Prompt da IA é 38k chars com cache_control ephemeral. Editar prompt invalida o cache (custo pula 10x na próxima conversa).
- Dados que mudam frequentemente (preço de promo, horário, modalidades) NÃO devem estar misturados com regras fixas.
- Editor antigo era textarea de 38k chars — fácil quebrar regra distante quando ia atualizar valor de plano.

**Implementação (PR #30):**
- Tabela `academia_info(key, value, label, description, category, display_order, updated_at)`
- Seed automático com 16 chaves padrão (planos, horários, modalidades, etc)
- `db.buildAcademiaInfoBlock()` monta string formatada das infos preenchidas (vazias não vão pro prompt — controle explícito de "o que a IA sabe")
- `agent.reply()` injeta o bloco no `dynamicCtx` (não cacheado) com instrução "estes valores valem em conflito"
- UI: aba "Conhecimento" agrupa por categoria, save automático no blur

**Resultado:** atualizar valor de plano = editar 1 célula. Próxima resposta da IA já usa o valor novo. Zero risco de quebrar prompt.

---

## 2026-05-02 — SSE em vez de WebSocket pra real-time

**Decisão:** Server-Sent Events (uni-direcional servidor→cliente) em vez de WebSocket bidirecional pra atualizar painel em tempo real.

**Por quê:**
- Casos de uso são todos servidor→cliente (msg nova, status change, conexão caiu). Cliente→servidor já vai por HTTP REST normal.
- SSE é mais simples: HTTP-based, atravessa qualquer proxy, sem lib extra (`EventSource` é nativo do browser), sem heartbeat custom (já tem ping built-in).
- Polling antigo (5s) consumia ~6 GB egress/usuário/mês. SSE consome ~50 MB. Mas a real motivação não foi custo (era irrelevante na escala atual) — foi UX (latência ~100ms vs 3-5s).
- WebSocket adicionaria Socket.io ou similar, lógica de reconexão custom, complexidade pra ganho zero.

**Implementação (PR #27):**
- `src/events.js`: EventEmitter singleton com coalesce de 250ms por phone
- DB hooks emitem em writes (`addMessage`, `updateMessageDeliveryStatus`, etc)
- `/admin/api/events` (SSE): heartbeat 25s, cleanup automático em `req.close`
- Frontend: `EventSource` reconecta sozinho, polling vira fallback de 30s

---

## 2026-05-02 — Pipeline do TTS pra envio de áudio (em vez de opus/ogg "canônico")

**Decisão:** Áudio enviado pelo painel passa pelo MESMO pipeline que o TTS usa há semanas (MP3 + libmp3lame 64k + fetch + ordem de campos `file/type/messaging_product`).

**Por quê:**
Saga de 6 PRs (#5-#11) tentando enviar áudio do painel falhando silenciosamente — Meta API aceitava upload e `/messages` retornava 200 OK mas o lead não recebia.

Tentei nesta ordem:
1. webm direto → silent fail
2. transcode webm→ogg via ffmpeg copy → silent fail
3. opus 64k stereo via libopus → silent fail
4. opus mono 16kHz 32k -application voip ("params canônicos de voice message") → silent fail

User percebeu o óbvio: **a IA já mandava áudio com sucesso há semanas via TTS**. Comparando os caminhos:
| | TTS (funciona) | Manual (falhava) |
|---|---|---|
| Format | audio/mpeg (MP3) | audio/ogg (Opus) |
| HTTP client | fetch + native FormData | axios + FormData |
| Field order | file → type → messaging_product | inverso |

Replicando o pipeline inteiro do TTS, o caminho manual passou a funcionar imediatamente.

**Lição:** quando algo já funciona em produção, **replique o caminho inteiro** em vez de variar pra "o que deveria funcionar segundo docs". A doc da Meta dizia que aceitava ogg/opus, mas na prática o caminho MP3 + fetch + ordem específica é o que entrega.

---

## 2026-05-02 — Dockerfile em vez de Nixpacks

**Decisão:** Usar `Dockerfile` (node:20-slim) em vez do Nixpacks default do Railway pra build.

**Por quê:**
Nixpacks ignorou config de `aptPkgs` e `nixPkgs` no `nixpacks.toml` (PRs #5 e #6 tentaram). Resultado: ffmpeg não instalava, `[server] ⚠️ ffmpeg NÃO encontrado no PATH` no boot.

Switch pra Dockerfile (PR #7) com `apt-get install ffmpeg build-essential python3 ca-certificates` deu controle total e determinístico. Build leva ~3min na primeira vez (apt + native compile do better-sqlite3), mas cache faz builds subsequentes serem rápidos.

**Bonus** (PR #8): mudei `CMD ["npm", "start"]` pra `CMD ["node", "src/index.js"]` direto — npm engole stack traces em alguns casos, dificulta debug.

---

## 2026-05-01 — Inbox multi-agente próprio em vez de ChatPro/Wati

**Decisão:** Construir inbox + handoff IA-humano dentro do painel /admin existente, em vez de migrar pra plataforma SaaS de WhatsApp Business (ChatPro, Wati, Kommo, Z-API).

**Por quê:**
- ChatPro/Wati = R$ 200-500/mês recorrente + obrigaria abandonar a IA customizada (38k de prompt + voz clonada + scripts A.V.I.A.R.C.)
- A IA delas é genérica (GPT-3.5/4o-mini com prompt configurável), produto inferior
- Custo do nosso stack atual: R$ 180-650/mês (Claude + ElevenLabs + Whisper + Railway)
- Pagar AMBOS não fecha conta. Migrar tudo pra ChatPro joga fora 1 mês de trabalho de prompt
- Construir multi-agente próprio: ~10 dias úteis, R$ 0 recorrente extra, mantém o diferencial

**Alternativas descartadas:**
- ChatPro/Wati → analisado acima
- Meta Business Manager Inbox embutido → grátis mas UX ruim (cada consultora cria conta Meta, interface lenta)
- Hybrid (2 números: bot Cloud API + consultoras WhatsApp Business) → fragmenta UX do lead, perde handoff seamless

**Tradeoffs aceitos:**
- ❌ Sem app mobile dedicado (consultora usa o painel pelo browser do celular)
- ❌ Sem mensagens agendadas, broadcast em massa, templates pré-prontos, Kanban visual
- Se algum desses virar crítico, avalia plataforma específica DEPOIS de medir necessidade real

**Arquitetura escolhida:**
- Auth multi-usuário com role admin/consultora (scrypt + cookie httpOnly + sessions em SQLite, sem deps novas)
- Pool aberto: qualquer consultora pode "assumir" qualquer conversa (race protection com UPDATE WHERE NULL)
- Webhook checa `human_assumed_at` antes da IA. Se humano assumiu, IA NÃO roda
- Polling de 5s + Notification API (sem websocket, sem React, sem build)
- Bootstrap UI em vez de senha-padrão hardcoded ou script CLI

---

## 2026-05-01 — Roteamento aluno vs lead determinístico (não NLP)

**Decisão:** Aluno é identificado por phone cadastrado em tabela `students`, NÃO por o SDR detectar via NLP. Se phone está cadastrado, IA não roda — resposta padrão + notifica dono.

**Por quê:** Aluno raramente diz "sou aluno" — manda direto *"que horas começa a aula hoje?"* ou *"posso trocar de plano?"*. SDR sem sinal externo trataria como prospect e ofereceria aula experimental pra quem já paga R\$249/mês. Risco de cancelamento real.

**Alternativas descartadas:**
- Cenário "já é aluno" no prompt (existia) → frágil, depende de NLP
- LLM-classifier antes de responder → custo + latência, ainda dependente de NLP
- IA com prompt "modo aluno" separado → complexidade alta, ainda pode errar respostas operacionais
- Menu URA "Você é aluno (1) ou lead (2)?" → UX de chatbot 2010

**Princípio sócio:** Risco assimétrico. Aluno mal atendido = cancelamento = perda recorrente. Prospect mal atendido = só vai embora. Modelo determinístico tira a IA do caminho onde o erro é mais caro.

**Quando reavaliar:** se aparecer demanda real ("aluno reclamou que demora resposta humana"), aí evolui pra IA modo-aluno (Opção B/C). Por enquanto Opção A é suficiente.

---

## 2026-05-01 — Delay de digitação proporcional ao tamanho da resposta

**Decisão:** Antes de enviar resposta de texto, aguardar `Math.min(3000, Math.max(1000, text.length * 25))` ms ≈ 40 chars/s.

**Por quê:** Resposta de IA chegando instantaneamente em ~3s soa robótica. Adicionar 1-3s simula humano digitando. Proporcional ao tamanho porque "Sim" não pode demorar igual a "tabela completa de planos…".

**Alternativas descartadas:**
- Delay fixo 3s → curto demais pra resposta longa, longo pra "sim"
- Typing indicator da Meta Cloud API → mais bonito mas mais complexo, dois POSTs em vez de um
- Delay no `sendMessage` global → vazaria para `notifyOwner`/`notifyStudent` (notificação tem que sair rápido)

**Implementação:** delay no webhook.js antes do `sendMessage` de resposta. Áudio pulado (TTS já tem latência natural).

---

## 2026-05-01 — Coleta de feedback em camadas (Camada 1 antes de Mixpanel/RAG)

**Decisão:** Construir sistema de avaliação manual de conversas (👍/👎/🚩 + comentário) antes de qualquer ferramenta externa de analytics ou solução técnica pra "esquecimento" do SDR.

**Por quê:** O usuário pediu solução pra "SDR esquecer coisas / lidar com toda objeção". Sem dados reais de produção, qualquer arquitetura (RAG, function calling, state machine, self-critique) é chute caro. Camada 1 dá munição pra atacar problema específico em vez de teórico.

**Arquitetura escolhida (3 camadas):**
1. **Camada 1 (feita):** review manual no painel — botões + comentário, salva em SQLite
2. **Camada 2 (futura):** funil + métricas operacionais — eventos `qualified`, `price_revealed`, `appointment_scheduled`, etc.
3. **Camada 3 (futura):** tracking de custo por lead — input/output/cache tokens da Anthropic API

**Alternativas descartadas (todas pra "depois", se precisar):**
- Mixpanel/Posthog/Amplitude → overkill pra 1 cliente, dado já no SQLite
- Auto-análise diária com LLM → vale só depois de Camada 1 mostrar onde dói
- Grafana/Prometheus → observabilidade industrial pra SDR de 1 academia é piada
- RAG / function calling / self-critique → primeiro identificar QUAL problema real antes de escolher solução

**Princípio sócio:** "Não construa antiesquecimento universal sem ter visto o esquecimento real." Mesma lógica que evitou state machine: trocar Haiku → Sonnet em 1 linha resolveu. Aqui: 2 semanas de marcação manual mostram onde atacar.

---

## 2026-05-01 — Tag-based appointment detection (não NLP/regex)

**Decisão:** SDR coloca tag `[AGENDAMENTO:nome=X|dia=X|hora=X|modalidade=X]` no início da resposta quando lead confirma. Sistema parseia, salva, remove a tag antes de enviar.

**Por quê:** O SDR já tem todo o contexto da conversa. Em vez de tentar adivinhar via NLP "o lead confirmou um horário?", o próprio LLM sinaliza. Zero ambiguidade, zero chamadas extras de API.

**Alternativas descartadas:**
- Regex no código procurando "terça às 9h" → frágil, falsos positivos
- LLM classificador separado (2ª chamada por mensagem) → custo extra, latência extra
- Function calling/tool use → mais complexo de manter, mesmo resultado

---

## 2026-05-01 — Sonnet 4.5 em vez de Haiku 4.5

**Decisão:** Usar `claude-sonnet-4-5-20250929` em vez de Haiku.

**Por quê:** Após 4-5 iterações refinando o prompt pra Haiku, ainda tinha bugs de instruction-following (despejava info, pulava regras). Sonnet com o MESMO prompt obedeceu na 1ª tentativa em todos os 4 cenários de teste. Custo extra: ~3x por mensagem (~R$0,03), insignificante pra o valor de cada lead.

**Alternativas descartadas:**
- Multi-agente por stage → complexidade alta, não fixa o problema raiz (cada agente teria a mesma limitação)
- State machine single-agent → idem
- Claude Opus → 5x mais caro, qualidade marginal melhor pra esse uso
- GPT-4o → menos compliance que Sonnet em testes anteriores
- Gemini 2.5 Pro → não testado, qualidade incerta
- Manter Haiku + extended thinking → caro e com latência

**Princípio:** trocar modelo é o teste mais barato pra problemas de compliance. Antes de gastar 1 semana em arquitetura, gastar 30s trocando 1 linha.

---

## 2026-05-01 — Prompt em 4 camadas (anti "lost in the middle")

**Decisão:** SYSTEM_PROMPT estruturado em TOPO BLINDADO (regras inegociáveis no início) + Regras detalhadas + Base de conhecimento + LEMBRETE FINAL (regras inegociáveis no fim).

**Por quê:** Modelos têm efeito documentado de "lost in the middle" — atenção maior no começo e fim do prompt. Regras críticas no meio se diluem. Repetir as 5 regras essenciais nas duas extremidades ataca isso.

**Resultado:** Tamanho 56k → 38k chars (32% menos). Nenhuma regra perdida.

---

## 2026-05-01 — Prompt caching com cache_control ephemeral

**Decisão:** Separar `system` em 2 blocos: estático (cacheado, ~38k chars) + dinâmico (audio/time/return/firstMsg, sem cache).

**Por quê:** Prompt grande recalculado a cada mensagem é caro. Anthropic oferece cache de 5min com 90% desconto no input. Em conversas com várias mensagens em sequência, isso é dramático.

**Custo:** Cache write é 1.25x do input normal (paga 1x ao escrever). Cache read é 0.1x (90% desconto). Em conversa de 10 mensagens, o break-even é na 2ª mensagem.

---

## 2026-05-01 — Prompt em arquivo separado (`src/prompt.js`)

**Decisão:** Mover SYSTEM_PROMPT pra arquivo dedicado, importado por agent.js.

**Por quê:** 38k chars de string template no agent.js polui o arquivo de lógica. Separação de concerns. Permite editar o prompt sem mexer em código.

**Atenção:** O prompt continua mutável em runtime via admin panel (`updateSystemPrompt`). O arquivo é apenas o DEFAULT na inicialização.

---

## 2026-05-01 — Hora específica obrigatória no agendamento (não janela)

**Decisão:** SDR sempre fecha com hora exata ("terça às 9h"), nunca janela ("terça de manhã"). Drill binário se lead vier vago.

**Por quê:** Consultora não consegue agendar nada com "terça de manhã". Precisa de hora pra confirmar e bloquear na agenda da academia.

**Implementação:**
- Tag exige campo `hora=X`
- Coluna `scheduled_hour` no DB
- Notificação mostra "terça às 9h"

---

## 2026-04-30 — SQLite (better-sqlite3) em vez de Firebase/Postgres

**Decisão:** SQLite com `better-sqlite3` rodando no volume persistente do Railway.

**Por quê:**
- Single-tenant pelos próximos 6 meses (1 cliente: STRONIX). Postgres/Firebase é overkill.
- SQLite é zero-config, super rápido, e backup é só copiar 1 arquivo.
- Volume persistente do Railway garante que dados sobrevivem a deploys.

**Alternativas descartadas:**
- Firebase: cloud-only (não funciona offline), vendor lock-in, async em tudo, queries limitadas (sem JOIN), custo cresce com volume
- Postgres: complexidade desnecessária pra 1 cliente
- DynamoDB: AWS-only, complexidade

**Quando reavaliar:** quando aparecer 2º cliente. Migração SQLite → Postgres é 1 dia de trabalho.

---

## 2026-04-30 — Railway em vez de DigitalOcean/AWS

**Decisão:** Hospedar no Railway.

**Por quê:**
- Setup em 15 minutos (vs ~3h no DigitalOcean)
- Auto-deploy via GitHub: push = deploy
- URL HTTPS fixa de graça (sem ngrok, sem certificado)
- Volume persistente nativo (1-click)
- Custo: ~$5/mês com uso real, plano hobby tem $5 de créditos grátis
- Logs e métricas no painel

**Alternativas descartadas:**
- DigitalOcean Droplet ($4/mês fixo, mais controle, mas precisa configurar Caddy/nginx, PM2, certbot)
- AWS EC2 (overkill, complexidade)
- Render (similar ao Railway, mas Railway tem volumes mais simples)
- Vercel (não suporta long-running server bem)

---

## 2026-04-30 — Token de 60 dias via Graph API Explorer (não System User)

**Decisão:** User Access Token estendido pra 60 dias.

**Por quê:** System User token via Business Manager não funcionou — a WhatsApp Account de teste do Meta não está disponível pra adicionar como ativo (é vinculada direto ao app de desenvolvedor). Fluxo da API Explorer + Token Debugger é o que funciona pra modo teste.

**Quando trocar:** Quando STRONIX migrar pro número real (verificado), aí System User funciona porque a WABA é vinculável ao Business Manager.

**Lembrete:** Renovar em julho de 2026.

---

## 2026-04-30 — Em-dash sanitizer no código (não só prompt)

**Decisão:** Regex `cleanText.replace(/\s*[—–]\s*/g, ', ')` no `agent.js` antes de enviar ao lead.

**Por quê:** Mesmo com a regra "PROIBIDO TRAÇO LONGO" no prompt, Claude às vezes usa. Garantia em código é dupla camada — prompt + post-processing.

---

## 2026-04-29 — Sistema de memória baseado em Markdown

**Decisão:** Usar arquivos `.md` versionados em `memory/` como sistema de memória do projeto.

**Por quê:** Permite que o Claude Code leia rapidamente o contexto sem varrer todo o código. Versionado junto com o projeto, preservando histórico de evolução.

---

## 2026-04-30 — Meta Cloud API em vez de Baileys/Evolution API

**Decisão:** Usar a API oficial do WhatsApp.

**Por quê:** Baileys e Evolution API podem banir o número. Risco inaceitável. Meta Cloud API é gratuita até 1.000 conversas/mês.

---

## 2026-04-30 — Express puro (sem framework adicional)

**Decisão:** Express puro, sem NestJS/Fastify.

**Por quê:** Escopo pequeno (webhook + envio). Frameworks maiores agregam complexidade desnecessária.
