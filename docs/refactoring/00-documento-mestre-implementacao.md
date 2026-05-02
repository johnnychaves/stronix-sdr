═══════════════════════════════════════════════════════════════
DOCUMENTO MESTRE — REFATORAÇÃO DO AGENTE JOHNNY (STRONIX)
GUIA DE IMPLEMENTAÇÃO PARA A PLATAFORMA
═══════════════════════════════════════════════════════════════

Versão: 1.0
Data: 2026
Status: pronto para implementação
Stack: plataforma própria com SQLite + parser de tags + dynamicCtx (já existente)

═══════════════════════════════════════════════════════════════
0. COMO USAR ESTE DOCUMENTO
═══════════════════════════════════════════════════════════════

Este documento é o GUIA MESTRE da refatoração. Ele acompanha 5 anexos:

ANEXO 1: nucleo-johnny-v2.md → o prompt principal do Johnny
ANEXO 2: modulos-batch1-conhecimento.md → 11 módulos de conhecimento factual
ANEXO 3: modulos-batch2-objecoes.md → 10 módulos de objeção
ANEXO 4: modulos-batch3-situacionais.md → 6 módulos situacionais
ANEXO 5: engrenagens-roteador-extrator-schema.md → roteador, parser e schema

Comece lendo este documento por inteiro. Os anexos são consultados na ordem das fases de implementação descritas abaixo.

═══════════════════════════════════════════════════════════════
1. SUMÁRIO EXECUTIVO
═══════════════════════════════════════════════════════════════

PROBLEMA QUE ESTAMOS RESOLVENDO

O Johnny (agente SDR de WhatsApp da STRONIX Academia) hoje opera com um único system prompt de mais de 30 mil caracteres. Esse formato monolítico causa:
- Perda de aderência às regras (agente "esquece" instruções)
- Falhas de qualificação (não conduz o lead pelo funil)
- Conflito interno de regras duplicadas
- Latência alta e custo de tokens elevado

SOLUÇÃO PROPOSTA

Refatoração para arquitetura em camadas:

CAMADA 1 — Núcleo enxuto (12.7k chars, cacheável)
Identidade, regras de ouro, máquina de estado explícita, estilo de comunicação.

CAMADA 2 — 27 módulos sob demanda (1.5-3k chars cada)
Conteúdo factual, objeções, situações específicas. Carregados dinamicamente pelo roteador.

CAMADA 3 — Ficha do lead persistida (banco de dados)
Estado da conversa estruturado, atualizado a cada turno via parser de tags.

CAMADA 4 — Resumo dinâmico (background)
Quando conversa passa de 15 mensagens, resumo estruturado substitui histórico bruto.

GANHOS ESPERADOS

- Tokens por chamada: ~30k → ~6-8k (redução de ~75%)
- Custo por mensagem: cai proporcionalmente, com cacheamento adicional do núcleo
- Qualidade da qualificação: sobe substancialmente devido à máquina de estado
- Manutenibilidade: ajustes em módulos isolados, sem risco de quebrar o resto
- Confiabilidade: regras determinísticas no backend (incremento de contadores)

═══════════════════════════════════════════════════════════════
2. ARQUITETURA EM ALTO NÍVEL
═══════════════════════════════════════════════════════════════

DIAGRAMA DE FLUXO (TEXTO):

LEAD MANDA MENSAGEM
        |
        v
[Backend recebe via WhatsApp]
        |
        v
[Identifica lead pelo telefone na tabela `leads`]
        |
        v
[Detecta tags de sistema: retornando, fora horário, áudio, etc]
        |
        v
[Incrementa contadores via regex: insistencias_valor, tentativas_objecao_atual]
        |
        v
[Chama ROTEADOR (modelo leve)]
   - Input: estado + tags + última mensagem
   - Output: lista de módulos a carregar
        |
        v
[Monta prompt: núcleo (cache) + estado + módulos + resumo + últimas 10 msgs]
        |
        v
[Chama JOHNNY (modelo principal)]
   - Output: resposta com tags [ESTADO:...] e [MODULO_REQUERIDO:...]
        |
        v
[Parser extrai tags, atualiza ficha, remove tags do texto]
        |
        v
[Verifica handoff humano]
        |
        v
[Envia resposta ao lead via WhatsApp]
        |
        v
[Atualiza contadores de mensagens]
        |
        v
[Se total > 15 mensagens: dispara gerador de resumo em background]

═══════════════════════════════════════════════════════════════
3. INVENTÁRIO DE COMPONENTES A IMPLEMENTAR
═══════════════════════════════════════════════════════════════

COMPONENTES NOVOS (precisam ser criados):

A) Tabela `leads` no banco
   - Schema completo no Anexo 5, seção 1
   - Indexada por telefone
   - Migrations idempotentes

B) Repositório de módulos
   - Estrutura de armazenamento (tabela ou arquivos)
   - Cada módulo: nome, conteúdo, metadados
   - Conteúdo dos 27 módulos nos Anexos 2, 3 e 4

C) Roteador de módulos
   - Modelo leve (Haiku 4.5 ou similar)
   - Prompt completo no Anexo 5, seção 2
   - Cache de respostas para mensagens repetidas (opcional, otimização)

D) Parser de tags expandido
   - Parser de [ESTADO:...] (novo)
   - Parser de [MODULO_REQUERIDO:...] (novo)
   - Parser de [AGENDAMENTO:...] (já existe, manter)
   - Parser de [AUDIO] (já existe ou similar, manter)
   - Lógica completa no Anexo 5, seção 3

E) Detector de pedido de valor (regex)
   - Lista de keywords no Anexo 5, seção 3
   - Incrementa insistencias_valor no backend antes de chamar Johnny

F) Detector de tentativas de objeção (lógica determinística)
   - Compara objecao_ativa atual com a anterior
   - Incrementa tentativas_objecao_atual
   - Força handoff_humano em 3 tentativas

G) Gerador de resumo dinâmico
   - Modelo leve em background
   - Prompt no Anexo 5, seção 4
   - Trigger: > 15 mensagens

H) Montador de prompt
   - Combina: núcleo (cache) + estado + módulos + resumo + últimas 10 msgs
   - Ordem importante (núcleo SEMPRE primeiro pra cache hit)

COMPONENTES QUE JÁ EXISTEM (manter):

- DB com migrations idempotentes (PRAGMA table_info)
- dynamicCtx injection (mecanismo de injeção dinâmica de contexto)
- Parser de tags ([AGENDAMENTO] já implementado)
- Princípio "LLM sinaliza estado > sistema adivinhar via NLP" (alinhado)

═══════════════════════════════════════════════════════════════
4. PLANO DE IMPLEMENTAÇÃO FASEADO
═══════════════════════════════════════════════════════════════

A implementação deve seguir 5 fases em ordem. Cada fase tem critérios de aceitação claros.

────────────────────────────────────────────────────────────
FASE 0 — INFRA BASE (preparação)
────────────────────────────────────────────────────────────

OBJETIVO: preparar a estrutura de dados e os parsers, sem ainda mexer no agente em produção.

TAREFAS:
1. Criar tabela `leads` com o schema completo do Anexo 5 seção 1.
2. Criar migrations idempotentes seguindo padrão `PRAGMA table_info`.
3. Criar repositório de módulos (estrutura de armazenamento).
4. Implementar parser de [ESTADO:...] (espelho do parser de [AGENDAMENTO]).
5. Implementar parser de [MODULO_REQUERIDO:...].
6. Implementar regex detector de pedido de valor.
7. Implementar lógica de incremento de tentativas_objecao_atual.

CRITÉRIO DE ACEITAÇÃO:
- Tabela existe, com índices corretos.
- Parsers funcionam em testes unitários: dada uma tag, extraem corretamente os campos.
- Regex de pedido de valor passa em casos: "qual o valor", "quanto custa", "tabela de preços", e NÃO dispara em casos: "valor da experiência", "qual o resultado".

────────────────────────────────────────────────────────────
FASE 1 — NÚCLEO + MONTADOR DE PROMPT (SEM MÓDULOS AINDA)
────────────────────────────────────────────────────────────

OBJETIVO: rodar o Johnny v2 só com o núcleo, sem o roteador. Validar que a máquina de estado funciona.

TAREFAS:
1. Carregar o conteúdo do Anexo 1 (núcleo-johnny-v2.md) como system prompt.
2. Implementar o montador de prompt na ordem: núcleo + estado da ficha + últimas 10 msgs + mensagem nova.
3. Configurar cacheamento do núcleo (parte cacheável).
4. Garantir que o parser de [ESTADO:...] atualiza a ficha após cada resposta.
5. Garantir que o parser de [MODULO_REQUERIDO:...] grava o pedido em log (não usado ainda nesta fase).
6. Rodar em ambiente de teste isolado.

CRITÉRIO DE ACEITAÇÃO:
- Em conversas simuladas, Johnny declara estagio na tag [ESTADO] e o backend grava na ficha.
- Avanço pelo roteiro de 5 passos é sequencial: qualificacao_inicial → qualificacao_objetivo → captura_nome → recomendacao_modalidade → proposta_visita → drill_horario → agendamento_confirmado.
- Lead que pede valor antes do tempo: insistencias_valor incrementa, Johnny defleti corretamente.
- Lead que pede valor 3x: estagio muda para apresentacao_planos.
- Tag [AGENDAMENTO] dispara quando dia + hora exata confirmados.

LIMITAÇÃO ESPERADA NESTA FASE:
- Sem módulos carregados, Johnny vai dizer "deixa eu confirmar com a equipe" para perguntas factuais (preços, horários, modalidades). Isso é INTENCIONAL nesta fase.

────────────────────────────────────────────────────────────
FASE 2 — ROTEADOR + CARREGAMENTO DE MÓDULOS
────────────────────────────────────────────────────────────

OBJETIVO: ativar o roteador e fazer os módulos serem carregados sob demanda.

TAREFAS:
1. Subir o repositório de módulos com os 27 módulos dos Anexos 2, 3 e 4.
2. Implementar o Roteador conforme Anexo 5 seção 2 (modelo leve, prompt completo).
3. Atualizar o montador de prompt para incluir conteúdo dos módulos retornados pelo Roteador.
4. Implementar fallback: se Johnny pediu [MODULO_REQUERIDO:X] e ele não foi carregado nesta chamada, marcar para carregar na próxima.
5. Implementar cache de Roteador (mensagens idênticas em mesmo estado retornam mesmo módulo).

CRITÉRIO DE ACEITAÇÃO:
- Lead pergunta "qual o horário?": Roteador retorna info_academia, módulo é injetado, Johnny responde com horário correto.
- Lead diz "tá caro": Roteador retorna objecoes_geral,objecao_preco, Johnny aplica método A.V.I.A.R.C.
- Lead diz "tô grávida": Roteador retorna publicos_especificos, Johnny acolhe corretamente.
- Lead pede valor 3x: Roteador retorna planos_e_precos,apresentacao_planos.
- Roteador NUNCA carrega mais de 2 módulos por vez.

────────────────────────────────────────────────────────────
FASE 3 — RESUMO DINÂMICO (MEMÓRIA MÉDIA)
────────────────────────────────────────────────────────────

OBJETIVO: lidar com conversas longas sem estourar contexto.

TAREFAS:
1. Implementar gerador de resumo conforme Anexo 5 seção 4.
2. Trigger: quando total_mensagens_lead + total_mensagens_johnny > 15 e não rodou nas últimas 10.
3. Roda em background (não bloqueia resposta ao lead).
4. Salva em ficha.resumo_dinamico.
5. Atualizar montador de prompt: se resumo existe, usa resumo + últimas 10 mensagens (em vez de histórico bruto).

CRITÉRIO DE ACEITAÇÃO:
- Conversa de 30 mensagens: a partir da 16ª, resumo dinâmico está presente na ficha.
- Resumo segue o formato estruturado obrigatório (LEAD, OBJETIVO, INSISTÊNCIAS, etc).
- Johnny mantém continuidade da conversa mesmo após substituição do histórico bruto.

────────────────────────────────────────────────────────────
FASE 4 — TESTES E AJUSTES FINOS
────────────────────────────────────────────────────────────

OBJETIVO: validar com casos reais e calibrar antes de subir pra produção.

TAREFAS:
1. Rodar o plano de testes da seção 5 deste documento.
2. Coletar 30-50 conversas reais (do Johnny v1 ou novas com v2 em teste).
3. Validar manualmente: o Johnny v2 conduz qualificação corretamente?
4. Ajustar módulos ou regras do Roteador conforme problemas detectados.
5. Implementar dashboard básico de monitoramento (% de conversas que chegam a agendamento, tempo médio até agendamento, taxa de handoff).

CRITÉRIO DE ACEITAÇÃO:
- Em 90% das conversas-teste, Johnny segue o roteiro de qualificação sem pular etapas.
- Em 100% das conversas-teste, regras inegociáveis (não passar valor cedo, não usar em-dash, não despejar info na primeira mensagem) são respeitadas.
- Tempo médio de resposta < 5 segundos.
- Custo médio por conversa < custo atual do v1.

═══════════════════════════════════════════════════════════════
5. PLANO DE TESTES COM CENÁRIOS REAIS
═══════════════════════════════════════════════════════════════

Baterias de teste a executar antes do lançamento.

────────────────────────────────────────────────────────────
BATERIA A — QUALIFICAÇÃO PURA (deve ser 100%)
────────────────────────────────────────────────────────────

TESTE A.1 — Lead novo padrão
Entrada: "oi, queria saber sobre a academia"
Esperado: saudação curta + pergunta binária treinando/parado. SEM listar valor/horário/endereço.

TESTE A.2 — Lead que tenta pular pra valor
Entrada: "oi, qual o valor?"
Esperado: deflexão "claro, já chegamos lá" + binária treinando/parado. insistencias_valor=1.

TESTE A.3 — Lead que insiste em valor
Sequência:
1. "qual o valor?" → deflexão (insistencias_valor=1)
2. "quanto custa?" → deflexão (insistencias_valor=2)
3. "me passa os valores aí" → APRESENTA PLANOS (insistencias_valor=3)

TESTE A.4 — Lead que responde qualificação completa sem pedir valor
Sequência:
1. "oi" → saudação + treinando/parado
2. "tô parado faz tempo" → reage + objetivo binário
3. "quero emagrecer" → reage + nome
4. "Maria" → reage + recomenda Musculação + manhã/tarde
5. "manhã" → escassez + terça/quarta
6. "terça" → drill 9h ou 10h
7. "9h" → tag [AGENDAMENTO] + confirmação
ESPERADO: NUNCA passar valor nesse fluxo.

────────────────────────────────────────────────────────────
BATERIA B — OBJEÇÕES
────────────────────────────────────────────────────────────

TESTE B.1 — Tá caro
Entrada após apresentação de planos: "tá caro pra mim"
Esperado: A.V.I.A.R.C. aplicado, sem desconto, com reposicionamento.

TESTE B.2 — Vou pensar
Entrada: "ah, vou pensar e te falo"
Esperado: investigação ("o que tu precisa avaliar?"), não aceita passivamente.

TESTE B.3 — Mês que vem
Entrada: "vou começar no próximo mês, tô me organizando"
Esperado: provocação leve + oferta de aula experimental como ponte.

TESTE B.4 — Gympass
Entrada: "vocês atendem Gympass?"
Esperado: resposta direta "não atendemos" + reposicionamento curto + pergunta retomando roteiro.

TESTE B.5 — Mensal
Entrada: "quero só o plano mensal"
Esperado: investigação (medo de não manter?) + reposicionamento + Plano Flex como opção real, sem insistir.

────────────────────────────────────────────────────────────
BATERIA C — PÚBLICOS ESPECIAIS
────────────────────────────────────────────────────────────

TESTE C.1 — Gestante
Entrada: "tô grávida, posso treinar?"
Esperado: acolhe + pede liberação obstetra + retoma roteiro.

TESTE C.2 — Idoso
Entrada: "tenho 67 anos, vocês atendem idoso?"
Esperado: tom respeitoso sem infantilizar + recomendação modalidade + retoma roteiro.

TESTE C.3 — Lesão
Entrada: "fiz cirurgia no joelho ano passado"
Esperado: NÃO diagnostica, NÃO prescreve treino, devolve pra "professor avalia".

────────────────────────────────────────────────────────────
BATERIA D — CENÁRIOS DE BORDA
────────────────────────────────────────────────────────────

TESTE D.1 — Pergunta se é IA
Entrada: "você é robô?"
Esperado: admite naturalmente + oferece falar com humano.

TESTE D.2 — Lead aluno
Entrada (lead já matriculado): "minha mensalidade não foi descontada"
Esperado: encaminha pro financeiro, NÃO tenta vender.

TESTE D.3 — Grosseria
Entrada: "isso é uma porcaria, vocês são uns ladrões"
Esperado: não devolve grosseria + handoff humano.

TESTE D.4 — Errou número
Entrada: "oi mãe, tô chegando"
Esperado: cordial, encerra educadamente.

────────────────────────────────────────────────────────────
BATERIA E — MÁQUINA DE ESTADO (REGRESSÃO)
────────────────────────────────────────────────────────────

TESTE E.1 — Estado persiste entre mensagens
Verificar que ficha do lead é atualizada corretamente em cada turno.

TESTE E.2 — Tags válidas e inválidas
Forçar Johnny a emitir tag malformada e verificar que backend NÃO crashe.

TESTE E.3 — Conversa longa (> 15 mensagens)
Verificar que resumo dinâmico é gerado e usado corretamente.

TESTE E.4 — Handoff automático
Verificar que após 3 tentativas de mesma objeção, estagio muda para handoff_humano.

═══════════════════════════════════════════════════════════════
6. FAQ TÉCNICO PROVÁVEL
═══════════════════════════════════════════════════════════════

P: O núcleo tem 12.7k caracteres. Ainda é grande. Não dá pra encolher mais?
R: Tentativas de encolher abaixo disso comprometem a máquina de estado ou a definição de estilo. A redução real está na caching: o núcleo é IDÊNTICO em toda chamada, então deve ser cacheado. Tokens cacheados custam ~10% do preço normal. Com cache, o custo efetivo do núcleo é equivalente a ~1.3k caracteres não cacheados.

P: O Roteador pode errar e carregar módulo errado. O que acontece?
R: Duas defesas:
1. Johnny tem regra "nunca invente" — se não tem info no contexto, diz "deixa eu confirmar".
2. Johnny emite [MODULO_REQUERIDO:X] na resposta. Se ele pediu módulo que o Roteador não carregou, isso é registrado e o módulo é carregado na PRÓXIMA chamada (auto-correção).

P: E se a tag [ESTADO] vier vazia ou malformada?
R: Backend mantém o estado anterior, loga o erro, e segue. Nunca crashe, nunca "esqueça" o lead.

P: Como debugar uma conversa que deu errado?
R: A ficha do lead tem todo o histórico de estado. É possível reconstruir exatamente em que estágio a conversa estava em cada turno, qual módulo foi carregado, e qual a resposta gerada. Recomenda-se logar Roteador + módulos carregados + tags emitidas em uma tabela de eventos.

P: Posso adicionar um módulo novo depois?
R: Sim. Basta:
1. Criar o conteúdo do módulo seguindo o padrão (GATILHO + CONTEÚDO + USO).
2. Adicionar ao repositório.
3. Adicionar ao prompt do Roteador (lista de módulos + regra de roteamento).
4. Testar com casos do gatilho.

P: O Johnny pode ser usado em outras academias do grupo?
R: Sim, mas exige:
1. Substituir Anexo 1 (núcleo) com a identidade da nova unidade.
2. Substituir o módulo info_academia, modalidades, planos_e_precos, equipe_tecnica.
3. O resto (objeções, públicos, cenários) é reaproveitável.

P: Quanto tempo de implementação total?
R: Estimativa preliminar (depende da plataforma):
- Fase 0: 2-3 dias
- Fase 1: 2-3 dias
- Fase 2: 3-5 dias
- Fase 3: 1-2 dias
- Fase 4: 5-7 dias (testes + ajustes)
TOTAL: ~3 semanas para implementação + validação.

═══════════════════════════════════════════════════════════════
7. CHECKLIST DE LANÇAMENTO
═══════════════════════════════════════════════════════════════

Antes de subir o Johnny v2 pra produção, validar:

INFRA
[ ] Tabela `leads` criada com schema completo
[ ] Repositório de módulos populado com os 27 módulos
[ ] Parsers de tags [ESTADO], [MODULO_REQUERIDO], [AGENDAMENTO] funcionando
[ ] Regex de pedido de valor calibrado
[ ] Cache do núcleo configurado
[ ] Logs de eventos da conversa em tabela dedicada

QUALIDADE
[ ] Bateria A (qualificação) passa em 100%
[ ] Bateria B (objeções) passa em 90%
[ ] Bateria C (públicos especiais) passa em 100%
[ ] Bateria D (cenários de borda) passa em 100%
[ ] Bateria E (máquina de estado) passa em 100%

OPERAÇÃO
[ ] Dashboard de monitoramento básico
[ ] Alertas para conversas que chegam em handoff_humano
[ ] Plano de rollback caso v2 apresente problema (manter v1 disponível)
[ ] Plano de gradual rollout (5% → 25% → 50% → 100% dos leads)

═══════════════════════════════════════════════════════════════
8. CONTEXTO ADICIONAL DO PROJETO
═══════════════════════════════════════════════════════════════

ORIGEM DO PROBLEMA: o Johnny v1 (prompt monolítico de 30k+) apresentava qualificação inadequada. Diagnóstico identificou três causas:
1. Diluição de atenção em prompt longo
2. Regras duplicadas com variações sutis (notadamente regra dos valores)
3. Falta de máquina de estado explícita (agente "deduzia" estágio do funil em vez de declarar)

DECISÕES TÉCNICAS DOCUMENTADAS:
- Máquina de estado via tags emitidas pela própria IA (alinhado ao princípio "LLM sinaliza estado > sistema adivinhar via NLP" já documentado em memory/MEMORY.md).
- Incremento de contadores (insistencias_valor, tentativas_objecao_atual) feito no BACKEND, não pela IA, garantindo determinismo.
- Roteador como modelo separado e leve, evitando o overhead de uma única chamada gigante.
- Núcleo cacheável para reduzir custo recorrente.

PRINCÍPIOS DE DESIGN:
1. Determinístico onde possível (regex, contadores, transições de estado válidas).
2. Modular (cada módulo é independente e testável isoladamente).
3. Resiliente (parsers nunca crasham; estado anterior é mantido em caso de erro).
4. Auditável (logs permitem reconstruir cada decisão da conversa).

CRITÉRIOS DE NÃO REGRESSÃO:
- Funcionalidade do Johnny v1 que JÁ FUNCIONAVA (tag [AGENDAMENTO], detecção de áudio, fora de horário) deve continuar funcionando idêntica no v2.
- Número de telefone do lead continua sendo a chave única.
- Integração com WhatsApp Business inalterada.

═══════════════════════════════════════════════════════════════
FIM DO DOCUMENTO MESTRE
═══════════════════════════════════════════════════════════════
