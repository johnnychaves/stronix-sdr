═══════════════════════════════════════════════════════════════
ENGRENAGENS — ROTEADOR, EXTRATOR E SCHEMA DA FICHA
═══════════════════════════════════════════════════════════════

Documento técnico das peças que fazem o sistema do Johnny funcionar como arquitetura modular. Inclui:

1. Schema da ficha do lead (banco de dados)
2. Prompt do Roteador de Módulos
3. Lógica do Extrator de Estado (parser de tags)
4. Prompt do Gerador de Resumo Dinâmico (memória média)
5. Fluxo completo de uma mensagem

═══════════════════════════════════════════════════════════════
1. SCHEMA DA FICHA DO LEAD
═══════════════════════════════════════════════════════════════

Tabela `leads` no banco. Indexada pelo telefone (chave única).

```
{
  "telefone": "string (chave primária)",
  "nome": "string | null",
  "estagio_atual": "enum: qualificacao_inicial | qualificacao_objetivo | captura_nome | recomendacao_modalidade | proposta_visita | drill_horario | agendamento_confirmado | objecao_ativa | apresentacao_planos | handoff_humano",
  "proxima_acao": "string (descrição curta)",
  "insistencias_valor": "integer (0,1,2,3)",
  "objetivo": "enum: vazio | resultado_fisico | qualidade_vida | massa | emagrecer",
  "modalidade_recomendada": "enum: vazio | musculacao | pilates | personalizado",
  "disponibilidade": "enum: vazio | manha | tarde",
  "objecao_ativa": "enum: vazio | preco | tempo | pensar | adiar | mensal | pagamento | conjuge | distancia | convenio",
  "objecoes_levantadas": "array de strings (histórico)",
  "tentativas_objecao_atual": "integer (0,1,2,3)",
  "aula_experimental_agendada": "boolean",
  "data_agendamento": "datetime | null",
  "hora_agendamento": "string | null",
  "modalidade_agendada": "string | null",
  "primeira_mensagem_em": "datetime",
  "ultima_mensagem_em": "datetime",
  "total_mensagens_lead": "integer",
  "total_mensagens_johnny": "integer",
  "resumo_dinamico": "text (gerado quando conversa > 20 msgs — ajustado de 15 no PR36)",
  "tags_sistema_ativas": "array de strings ([LEAD_RETORNANDO_APÓS_X_DIAS], [FORA_DO_HORÁRIO_COMERCIAL], etc)",
  "is_aluno_existente": "boolean",
  "encerrada_em": "datetime | null",
  "motivo_encerramento": "string | null"
}
```

REGRAS DA FICHA:
- Toda nova conversa cria um registro com `estagio_atual=qualificacao_inicial`, `insistencias_valor=0`, demais campos vazios.
- Campos só são atualizados via parser de tags (próxima seção).
- `objecoes_levantadas` é histórico cumulativo (lead pode ter trazido várias objeções na conversa).
- `tentativas_objecao_atual` zera quando objecao_ativa muda.
- Se `tentativas_objecao_atual` chega em 3, força `estagio_atual=handoff_humano`.

═══════════════════════════════════════════════════════════════
2. PROMPT DO ROTEADOR DE MÓDULOS
═══════════════════════════════════════════════════════════════

MODELO RECOMENDADO: Haiku 4.5 ou similar (rápido e barato).

PROMPT COMPLETO:

```
Você é um roteador de módulos para o agente SDR de WhatsApp da STRONIX Academia.

Sua tarefa: ler a mensagem mais recente do lead + estado atual da conversa, e decidir quais módulos de conhecimento devem ser carregados pra próxima resposta do agente Johnny.

Devolva APENAS uma lista de nomes de módulos separados por vírgula, sem espaços. Sem explicação, sem texto adicional.

MÓDULOS DISPONÍVEIS:

CONHECIMENTO FACTUAL:
- info_academia → endereço, horário, estrutura, equipamentos, app, "o que não atende" (Gympass, plano saúde, VR)
- modalidades → musculação, pilates, personalizado, diferenças
- planos_e_precos → tabela de preços (só carregar se estado.insistencias_valor>=3)
- apresentacao_planos → posicionamento Clube + após apresentar valores
- equipe_tecnica → coordenadora, avaliação, nutricionista, fisioterapeuta
- provas_sociais → casos reais (220kg, Seu Jorge)
- concorrencia → outras academias da região
- cancelamento_congelamento → fidelidade, multa, congelamento
- pagamento → cartão, PIX, parcelamento, limite
- indicacao → programa de indicação, pontos
- transferencia_clube → transferir plano Clube +
- fluxo_aula_experimental → como funciona visita, escassez, horários

OBJEÇÕES (sempre carregar objecoes_geral junto com o específico):
- objecoes_geral → princípios + A.V.I.A.R.C. + frases de alto nível
- objecao_preco → "tá caro", "muito alto", comparou com mais barata
- objecao_tempo → "sem tempo", "rotina apertada"
- objecao_pensar → "vou pensar", "depois te falo"
- objecao_adiar → "mês que vem", "depois do verão"
- objecao_mensal → "só mensal", "sem fidelidade"
- objecao_pagamento → "ocupa limite", "estourar fatura"
- objecao_conjuge → "falar com esposa/marido"
- objecao_distancia → "fica longe", "moro distante"
- objecao_convenio → "Gympass, plano saúde, VR"

SITUACIONAIS:
- publicos_especificos → gestante, pós-parto, idoso, restrição médica, adolescente, medo de "ficar musculosa", obesidade
- lead_retornando → tag [LEAD_RETORNANDO_APÓS_X_DIAS] ativa
- lead_aluno_existente → lead identificado como matriculado OU disse "sou aluno"
- cenarios_borda → grosseria, errou número, pediu humano, fora horário, perguntas estranhas
- audio → tags [LEAD_RESPONDEU_EM_AUDIO]/[AUDIO_LIBERADO] ativas OU momento estratégico
- tecnicas_persuasao → estagio=proposta_visita ou drill_horario, lead hesitante

REGRAS DE ROTEAMENTO:

1. CARREGAR NO MÁXIMO 2 MÓDULOS POR VEZ. Quanto menos, melhor.
2. Se nada se aplica, devolver "nenhum".
3. SEMPRE que carregar módulo de objeção, carregar objecoes_geral junto.
4. Tags de sistema têm prioridade sobre estado.

PRIORIDADE DE DECISÃO (na ordem):

A. Tags de sistema ativas?
   - [LEAD_RETORNANDO_APÓS_X_DIAS] → lead_retornando
   - [FORA_DO_HORÁRIO_COMERCIAL] → cenarios_borda
   - [LEAD_RESPONDEU_EM_AUDIO] ou [AUDIO_LIBERADO] → audio (combinar com módulo principal)

B. Lead é aluno existente?
   - Sim → lead_aluno_existente

C. Lead foi grosseiro, errou número, pediu humano, perguntou se é IA?
   - Sim → cenarios_borda

D. Lead mencionou condição específica (gestante, idoso, restrição, sobrepeso, adolescente, "ficar musculosa")?
   - Sim → publicos_especificos

E. Lead trouxe objeção?
   - Tá caro / mais barato / não tenho dinheiro → objecoes_geral, objecao_preco
   - Sem tempo / rotina apertada / não consigo encaixar → objecoes_geral, objecao_tempo
   - Vou pensar / depois te falo / preciso ver → objecoes_geral, objecao_pensar
   - Mês que vem / ano que vem / depois do verão → objecoes_geral, objecao_adiar
   - Só mensal / sem fidelidade → objecoes_geral, objecao_mensal
   - Ocupa limite / estourar fatura / só débito → objecoes_geral, objecao_pagamento
   - Falar com esposa/marido/família → objecoes_geral, objecao_conjuge
   - Fica longe / moro distante → objecoes_geral, objecao_distancia
   - Gympass / plano saúde / VR / convênio → objecoes_geral, objecao_convenio

F. Lead pediu valor E insistencias_valor já chegou em 3?
   - Sim → planos_e_precos, apresentacao_planos

G. Lead pediu valor E insistencias_valor < 3?
   - Sim → nenhum (núcleo cobre a regra de deflexão)

H. Lead fez pergunta factual?
   - Sobre endereço/horário/estrutura/Gympass-NÃO-atende → info_academia
   - Sobre modalidades/musculação/pilates/personalizado → modalidades
   - Sobre professores/avaliação/nutri/fisio → equipe_tecnica
   - Sobre cancelamento/fidelidade/congelamento → cancelamento_congelamento
   - Sobre formas de pagamento → pagamento
   - Sobre indicação de amigo/pontos → indicacao
   - Sobre transferir plano → transferencia_clube
   - Sobre outras academias / comparou → concorrencia

I. Estado=proposta_visita ou drill_horario?
   - Sim → fluxo_aula_experimental
   - Se lead hesitando → fluxo_aula_experimental, tecnicas_persuasao

J. Lead com insegurança forte ("será que vou conseguir", "tô muito fora de forma")?
   - Sim → provas_sociais

K. Nenhum dos acima?
   - Devolve "nenhum"

EXEMPLOS:

Estado: estagio=qualificacao_inicial|insistencias_valor=0
Tags: nenhuma
Lead: "oi, qual o horário?"
Resposta: info_academia

Estado: estagio=qualificacao_objetivo|insistencias_valor=1
Tags: nenhuma
Lead: "mas quanto tá custando?"
Resposta: nenhum

Estado: estagio=qualificacao_objetivo|insistencias_valor=3
Tags: nenhuma
Lead: "qual o valor?"
Resposta: planos_e_precos,apresentacao_planos

Estado: estagio=proposta_visita|insistencias_valor=2
Tags: nenhuma
Lead: "tá caro pra mim, não tenho como"
Resposta: objecoes_geral,objecao_preco

Estado: estagio=qualificacao_inicial
Tags: nenhuma
Lead: "tô grávida de 5 meses, posso treinar?"
Resposta: publicos_especificos

Estado: estagio=qualificacao_inicial
Tags: nenhuma
Lead: "atende Gympass?"
Resposta: objecoes_geral,objecao_convenio

Estado: estagio=qualificacao_inicial
Tags: [LEAD_RETORNANDO_APÓS_X_DIAS]
Lead: "oi, voltei!"
Resposta: lead_retornando

Estado: estagio=qualificacao_inicial
Tags: nenhuma, is_aluno_existente=true
Lead: "minha mensalidade não foi descontada"
Resposta: lead_aluno_existente

Estado: estagio=drill_horario|insistencias_valor=3
Tags: nenhuma
Lead: "ah não sei, vou pensar melhor"
Resposta: objecoes_geral,objecao_pensar

ENTRADA QUE VOCÊ VAI RECEBER:
[ESTADO_ATUAL]: campos da ficha do lead
[TAGS_SISTEMA]: tags ativas (ou "nenhuma")
[IS_ALUNO]: true ou false
[ULTIMA_MENSAGEM_LEAD]: texto da mensagem mais recente

SAÍDA: lista de módulos separados por vírgula sem espaço, ou "nenhum".
```

═══════════════════════════════════════════════════════════════
3. LÓGICA DO EXTRATOR DE ESTADO (PARSER DE TAGS)
═══════════════════════════════════════════════════════════════

OBSERVAÇÃO IMPORTANTE: o sistema NÃO precisa de um modelo de IA separado pra extrair estado. O Johnny já emite as tags estruturadas no início de cada resposta. O extrator é apenas um PARSER no backend, similar ao parser do [AGENDAMENTO] que já existe.

TAGS A PARSEAR:

TAG 1: [ESTADO:campo1=valor1|campo2=valor2|...]
- Extrai cada par campo=valor
- Atualiza a coluna correspondente na tabela leads
- Remove a tag da resposta antes de enviar pro WhatsApp

TAG 2: [MODULO_REQUERIDO:nome_ou_nenhum]
- Lê o nome do módulo solicitado
- Se diferente do que o roteador carregou, registra em log de auto-correção
- Marca pra usar como fallback se a próxima mensagem do lead repetir o assunto
- Remove a tag da resposta antes de enviar

TAG 3: [AGENDAMENTO:nome=X|dia=Y|hora=Z|modalidade=W]
- Aciona o fluxo de agendamento (lógica que já existe no projeto)
- Atualiza campos: aula_experimental_agendada=true, data_agendamento, hora_agendamento, modalidade_agendada
- Remove a tag da resposta antes de enviar

TAG 4 (auto-incremento): se o lead na ÚLTIMA mensagem pediu valor (regex ou keyword) E insistencias_valor < 3:
- insistencias_valor += 1 ANTES de chamar o Johnny
- Esse incremento é feito pelo backend, NÃO depende da IA

TAG 5 (auto-incremento): se estagio_atual=objecao_ativa E o módulo carregado é o mesmo da mensagem anterior:
- tentativas_objecao_atual += 1
- Se chegar em 3, força estagio_atual=handoff_humano

KEYWORDS PRA DETECTAR PEDIDO DE VALOR (regex no backend):
- "valor", "preço", "preco", "quanto custa", "quanto fica", "quanto é", "mensalidade", "plano custa", "tabela", "valores", "preços", "precos", "investimento", "barato", "caro"

REGRAS DE VALIDAÇÃO:
- Se Johnny emitir tag inválida (campo desconhecido, valor fora do enum), o backend ignora aquele campo específico e mantém o anterior. NUNCA crashe.
- Loga toda tag inválida pra revisão manual posterior.
- Se Johnny NÃO emitir tag [ESTADO]: backend mantém estado anterior + adiciona alerta no log.
- Se Johnny emitir tag duplicada: usa a primeira ocorrência.

═══════════════════════════════════════════════════════════════
4. GERADOR DE RESUMO DINÂMICO (MEMÓRIA MÉDIA)
═══════════════════════════════════════════════════════════════

QUANDO ACIONAR:
- Quando total_mensagens_lead + total_mensagens_johnny > 20.
  > **Nota:** ajustado de 15 → 20 durante PR36 com base em análise de conversas
  > reais. Conversas que fecham em 15-18 msgs (lead engajado padrão) não pagam
  > o custo do Haiku desnecessariamente. Threshold de 20 = 10 turnos completos,
  > onde resumo passa a valer mais que o ruído do prompt bloat.
- Roda em background, sem bloquear resposta ao lead.
- Resultado salvo em ficha.resumo_dinamico.
- A partir daí, o histórico bruto do prompt usa: resumo_dinamico + últimas 10 mensagens (em vez de todas).

MODELO RECOMENDADO: Haiku 4.5 ou similar.

PROMPT:

```
Você é um sumarizador de conversas do agente SDR Johnny da STRONIX.

Sua tarefa: gerar um resumo estruturado e curto da conversa abaixo, focando no que importa pra continuar o atendimento.

Devolva APENAS o resumo no formato indicado. Sem preâmbulo, sem comentário.

FORMATO OBRIGATÓRIO:

LEAD: [nome se conhecido, "não informado" caso contrário]
OBJETIVO: [resultado físico / qualidade de vida / emagrecer / ganhar massa / não declarado]
DISPONIBILIDADE: [manhã / tarde / não declarada]
MODALIDADE INDICADA: [musculação / pilates / personalizado / não definida]
INSISTÊNCIAS DE VALOR: [número de vezes que pediu preço]
OBJEÇÕES JÁ LEVANTADAS: [lista, ou "nenhuma"]
NÍVEL DE ENGAJAMENTO: [alto / médio / baixo]
INFOS PESSOAIS RELEVANTES: [3 frases curtas no máximo, sobre rotina/contexto/dor/medo]
HISTÓRICO DE TENTATIVAS DE FECHAMENTO: [resumo curto: o que foi proposto, o que ele respondeu]
PRÓXIMA AÇÃO RECOMENDADA: [1 frase clara]

CONVERSA A RESUMIR:
[mensagens]
```

USO:
- Esse resumo entra no prompt como bloco "CONTEXTO PRÉVIO" no lugar das mensagens antigas.
- O Johnny lê o resumo + últimas 10 mensagens + estado atual + módulos carregados.
- Atualiza a cada 10 mensagens novas (se a conversa continuar longa).

═══════════════════════════════════════════════════════════════
5. FLUXO COMPLETO DE UMA MENSAGEM
═══════════════════════════════════════════════════════════════

Sequência exata que o backend executa quando o lead manda mensagem:

PASSO 1 — RECEBE MENSAGEM
- Captura: telefone, texto, tipo (texto/áudio/imagem), timestamp.

PASSO 2 — IDENTIFICA LEAD
- Busca registro na tabela `leads` pelo telefone.
- Se não existe: cria novo registro com estagio_atual=qualificacao_inicial, demais campos vazios.

PASSO 3 — DETECTA TAGS DE SISTEMA
- Calcula tags ativas: [LEAD_RETORNANDO_APÓS_X_DIAS] (se ultima_mensagem_em > 30 dias atrás), [FORA_DO_HORÁRIO_COMERCIAL] (se fora do horário), [LEAD_RESPONDEU_EM_AUDIO] (se tipo=áudio), etc.
- Salva em tags_sistema_ativas.

PASSO 4 — INCREMENTA CONTADORES (regex no backend)
- Detecta keywords de pedido de valor → insistencias_valor += 1 (se < 3).
- Se em estagio=objecao_ativa E mesma objeção da mensagem anterior → tentativas_objecao_atual += 1.

PASSO 5 — CHAMA O ROTEADOR
- Modelo leve (Haiku ou similar).
- Input: estado atual + tags + is_aluno + última mensagem.
- Output: lista de módulos a carregar (máx 2).

PASSO 6 — MONTA PROMPT FINAL
Ordem de injeção no contexto:
1. Núcleo do Johnny (cacheável)
2. Bloco de estado atual do lead (não cacheável)
3. Conteúdo dos módulos carregados (não cacheável)
4. Resumo dinâmico (se existir)
5. Últimas 10 mensagens da conversa
6. Mensagem nova do lead

PASSO 7 — CHAMA O JOHNNY
- Modelo principal (Sonnet ou Opus).
- Gera resposta com tags [ESTADO:...] e [MODULO_REQUERIDO:...] no início.

PASSO 8 — PARSEIA TAGS DA RESPOSTA
- Extrai e atualiza ficha do lead.
- Remove tags do texto.

PASSO 9 — VERIFICA HANDOFF
- Se estagio_atual=handoff_humano: notifica equipe humana, envia resumo da ficha.

PASSO 10 — ENVIA RESPOSTA AO LEAD
- Texto limpo (sem tags) via WhatsApp.
- Se [AUDIO] estava no início: gera áudio (TTS) e envia como áudio.

PASSO 11 — ATUALIZA CONTADORES E TIMESTAMPS
- total_mensagens_lead, total_mensagens_johnny, ultima_mensagem_em.

PASSO 12 — DISPARA RESUMO DINÂMICO (background)
- Se total > 15 e não roda há mais de 10 mensagens: chama gerador de resumo.

═══════════════════════════════════════════════════════════════
6. CONSIDERAÇÕES DE PERFORMANCE E CUSTO
═══════════════════════════════════════════════════════════════

POR MENSAGEM RECEBIDA:
- 1 chamada ao Roteador (modelo leve, ~500 tokens entrada / ~10 tokens saída)
- 1 chamada ao Johnny (modelo principal, ~6-8k tokens entrada / ~150 tokens saída)
- Eventualmente, 1 chamada ao Sumarizador (modelo leve, em background, ~3k tokens entrada / ~200 tokens saída)

CACHEAMENTO:
- O Núcleo (~12.7k caracteres) é IDÊNTICO em toda chamada → CACHEAR.
- Estado, módulos, histórico → NÃO cacheáveis (mudam toda mensagem).

ECONOMIA ESTIMADA vs PROMPT MONOLÍTICO ATUAL (30k):
- Tokens por chamada: cai de ~30k para ~6-8k → redução de ~75%.
- Latência: cai proporcionalmente.
- Qualidade: sobe (atenção concentrada no que importa).

═══════════════════════════════════════════════════════════════
FIM — ROTEADOR, EXTRATOR E SCHEMA PRONTOS
═══════════════════════════════════════════════════════════════
