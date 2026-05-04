// ═══════════════════════════════════════════════════════════════
// V3-TOOLS — Definição da tool `responder_ao_lead` (Anthropic tool use)
// ═══════════════════════════════════════════════════════════════
//
// PR1 da migração v3: substitui o canal frágil de tags em texto livre
// (`[ESTADO:...]`, `[MODULO_REQUERIDO:...]`, `[AGENDAMENTO:...]`,
// `[AUDIO]`, `[PEDIR_AUDIO]`) por uma única ferramenta forçada via
// `tool_choice: { type: "tool", name: "responder_ao_lead" }`.
//
// Atomicidade: estado novo + mensagem ao lead + módulo do próximo turno
// saem JUNTOS no mesmo input. Impossível ter um sem o outro.
//
// Reuso: agent-v3.js converte o input da tool no MESMO formato `parsed`
// do parser de tags do v2 (parseAndStripTags), preservando computeStateUpdate
// e toda a lógica de máquina de estado existente.

// ─────────────────────────────────────────────────────────────────────
// ENUMS — espelho exato dos VALID_* de db.js + módulos do prompt-modules-seed
// ─────────────────────────────────────────────────────────────────────

const ESTAGIOS = [
  'qualificacao_inicial', 'qualificacao_objetivo', 'captura_nome',
  'recomendacao_modalidade', 'proposta_visita', 'drill_horario',
  'agendamento_confirmado', 'objecao_ativa', 'apresentacao_planos',
  'handoff_humano',
];

const OBJETIVOS = ['', 'resultado_fisico', 'qualidade_vida', 'massa', 'emagrecer'];
const MODALIDADES = ['', 'musculacao', 'pilates', 'personalizado'];
const DISPONIBILIDADES = ['', 'manha', 'tarde'];
const OBJECOES = ['', 'preco', 'tempo', 'pensar', 'adiar', 'mensal', 'pagamento', 'conjuge', 'distancia', 'convenio'];

// 28 módulos — espelha src/prompt-modules-seed.js (snake_case names).
// Ordem: conhecimento (12) → objecoes (10) → situacionais (4) → sistema (3 — fluxo, audio, persuasao).
const MODULOS = [
  'info_academia', 'modalidades', 'planos_e_precos', 'apresentacao_planos',
  'equipe_tecnica', 'provas_sociais', 'concorrencia', 'cancelamento_congelamento',
  'pagamento', 'indicacao', 'transferencia_clube', 'fluxo_aula_experimental',
  'objecoes_geral', 'objecao_preco', 'objecao_tempo', 'objecao_pensar',
  'objecao_adiar', 'objecao_mensal', 'objecao_pagamento', 'objecao_conjuge',
  'objecao_distancia', 'objecao_convenio',
  'publicos_especificos', 'lead_retornando', 'lead_aluno_existente', 'cenarios_borda',
  'audio', 'tecnicas_persuasao',
];

const TOOL_NAME = 'responder_ao_lead';

// ─────────────────────────────────────────────────────────────────────
// TOOL DEFINITION — passada em `tools: [...]` na chamada Anthropic
// ─────────────────────────────────────────────────────────────────────

function buildToolDefinition() {
  return {
    name: TOOL_NAME,
    description:
      'Único caminho pra responder ao lead E atualizar o estado da conversa. ' +
      'Chame esta ferramenta exatamente UMA vez por turno. ' +
      'Não escreva nada fora dela: a mensagem ao lead vai em `mensagem_ao_lead`, ' +
      'o estado novo em `estado_atual`, e o módulo do próximo turno (se precisar) em `modulo_proximo_turno`. ' +
      'Substitui completamente as tags `[ESTADO:...]`, `[MODULO_REQUERIDO:...]`, `[AGENDAMENTO:...]`, `[AUDIO]` e `[PEDIR_AUDIO]` do v2.',
    input_schema: {
      type: 'object',
      required: ['estado_atual', 'mensagem_ao_lead'],
      properties: {
        estado_atual: {
          type: 'object',
          description: 'Estado da máquina após este turno. Espelha lead_state do v2 — mesmas regras de transição.',
          required: ['estagio', 'proxima_acao'],
          properties: {
            estagio: {
              type: 'string',
              enum: ESTAGIOS,
              description: 'Etapa da máquina de estado após este turno.',
            },
            proxima_acao: {
              type: 'string',
              maxLength: 200,
              description: 'Descrição curta (até 200 chars) do que tu fez neste turno.',
            },
            insistencias_valor: {
              type: 'integer',
              minimum: 0,
              maximum: 3,
              description: 'Quantas vezes lead já pediu valor (0–3). Backend pode ter incrementado antes; reflita o valor real.',
            },
            objetivo: {
              type: 'string',
              enum: OBJETIVOS,
              description: 'Objetivo declarado pelo lead. Vazio se ainda não declarado.',
            },
            nome: {
              type: 'string',
              maxLength: 60,
              description: 'Nome do lead se foi capturado neste turno ou anteriormente. Vazio se ainda não capturado.',
            },
            modalidade: {
              type: 'string',
              enum: MODALIDADES,
              description: 'Modalidade que tu recomendou. Vazio até a recomendação ser feita.',
            },
            disponibilidade: {
              type: 'string',
              enum: DISPONIBILIDADES,
              description: 'Janela do lead (manhã ou tarde). Vazio se ainda não declarada.',
            },
            objecao_ativa: {
              type: 'string',
              enum: OBJECOES,
              description: 'Objeção sendo trabalhada agora. Vazio se não há objeção ativa neste turno.',
            },
          },
        },
        mensagem_ao_lead: {
          type: 'string',
          minLength: 1,
          maxLength: 2000,
          description:
            'Texto puro que vai pro WhatsApp. SEM tags entre colchetes. SEM em-dash (— ou –). ' +
            'Use o tom da persona (informal, gírias permitidas, curto).',
        },
        responder_em_audio: {
          type: 'boolean',
          description:
            'true quando o lead mandou áudio nesta msg OU quando o momento pede áudio (objeção forte, fechamento, momento pessoal). Default false.',
        },
        pedir_audio_ao_lead: {
          type: 'boolean',
          description:
            'true SÓ quando ainda não tens permissão de áudio E o momento pede. Raro. Default false.',
        },
        modulo_proximo_turno: {
          type: 'string',
          enum: ['', ...MODULOS],
          description:
            'Sinaliza módulo a ser carregado no próximo turno (substitui `[MODULO_REQUERIDO:...]`). ' +
            'Use "" quando os módulos atuais bastam ou quando não há próximo turno previsto.',
        },
        agendamento: {
          type: 'object',
          description:
            'Preencha QUANDO o agendamento foi confirmado neste turno (estagio=agendamento_confirmado). Caso contrário deixe os campos vazios ou omita o objeto.',
          properties: {
            nome: { type: 'string' },
            dia: { type: 'string' },
            hora: { type: 'string' },
            modalidade: { type: 'string' },
          },
        },
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// ADDENDUM — instrução curta que vai NO FIM do system prompt v3
// (após blocos cacheados, antes do dynamic ctx). Ensina o modelo a usar
// a tool em vez das tags do v2. Não invalida o cache do nucleo + KB.
// ─────────────────────────────────────────────────────────────────────

const ADDENDUM_V3 = `═══ MODO V3 — TOOL USE OBRIGATÓRIO ═══
Você AGORA usa a ferramenta \`${TOOL_NAME}\` em vez de tags em texto livre.

REGRAS DESTE MODO (sobrescrevem qualquer instrução de tag do prompt principal):
• Chame \`${TOOL_NAME}\` exatamente UMA vez por turno. Não emita texto fora dela.
• NÃO escreva [ESTADO:...], [MODULO_REQUERIDO:...], [AGENDAMENTO:...], [AUDIO] ou [PEDIR_AUDIO] no texto da mensagem.
• O campo \`mensagem_ao_lead\` é o que vai pro WhatsApp — texto puro, sem tags, sem em-dash.
• \`estado_atual\` substitui [ESTADO:...] — mesmos campos, mesmos enums.
• \`modulo_proximo_turno\` substitui [MODULO_REQUERIDO:...] — use "" quando os módulos atuais bastam.
• \`agendamento\` substitui [AGENDAMENTO:...] — preencha apenas quando confirmado.
• \`responder_em_audio: true\` substitui o [AUDIO] no início da resposta.
• \`pedir_audio_ao_lead: true\` substitui [PEDIR_AUDIO].

Todo o resto do prompt (regras de ouro, máquina de estado, persona, módulos) continua válido. Só muda o canal de saída.`;

// ─────────────────────────────────────────────────────────────────────
// EXTRAÇÃO + CONVERSÃO — tool_use → formato compatível com `parsed` do v2
// ─────────────────────────────────────────────────────────────────────

// Acha TODOS os blocos tool_use da response que matchem TOOL_NAME.
// Com tool_choice forçado + disable_parallel_tool_use, a API garante exatamente 1.
// Se vier 0, é sanity check (TOOL_CALL_AUSENTE). Se vier 2+, é canário de mudança
// de contrato da Anthropic (TOOL_CALL_MULTIPLE) — quem chama deve logar pra Monitor
// detectar regressão antes de impactar prod. Aceita response null/malformado.
function findAllToolUseBlocks(response) {
  if (!response || !Array.isArray(response.content)) return [];
  return response.content.filter(
    b => b && b.type === 'tool_use' && b.name === TOOL_NAME
  );
}

// Pega o input do PRIMEIRO bloco tool_use. Retorna null se ausente.
// Com a API garantindo 1 bloco único, "primeiro" === "único" em produção normal.
function extractToolInput(response) {
  const blocks = findAllToolUseBlocks(response);
  if (!blocks.length) return null;
  const first = blocks[0];
  if (!first || typeof first.input !== 'object' || first.input === null) return null;
  return first.input;
}

// Sanitiza texto: remove tags antigas (defesa contra hábito do prompt v2) + em-dash.
// Mesmas regras aplicadas em parseAndStripTags + agent-v2.js linha 404.
function sanitizeMensagem(raw) {
  if (typeof raw !== 'string') return '';
  let txt = raw;
  txt = txt.replace(/\[ESTADO:[^\]]+\]\s*\n?/gi, '');
  txt = txt.replace(/\[MODULO_REQUERIDO:[^\]]+\]\s*\n?/gi, '');
  txt = txt.replace(/\[AGENDAMENTO:[^\]]+\]\s*\n?/gi, '');
  txt = txt.replace(/\[AUDIO\]\s*/gi, '');
  txt = txt.replace(/\[PEDIR_AUDIO\]\s*/gi, '');
  txt = txt.replace(/\s*[—–]\s*/g, ', ');
  return txt.trim();
}

// Converte input da tool no formato `parsed` do parseAndStripTags v2.
// Retorna { stateFields, nameFromTag, requiredModule, agendamento, cleanText, useAudio, askingForAudio }.
// Mesmas keys que parseAndStripTags + 2 extras (useAudio, askingForAudio) — agent-v2 derivava
// useAudio do regex `/\[AUDIO\]/i`, agora vem direto do campo booleano.
function toolInputToParsed(input) {
  const out = {
    stateFields: null,
    nameFromTag: null,
    requiredModule: null,
    agendamento: null,
    cleanText: '',
    useAudio: false,
    askingForAudio: false,
  };
  if (!input || typeof input !== 'object') return out;

  const estado = (typeof input.estado_atual === 'object' && input.estado_atual) ? input.estado_atual : {};
  const stateFields = {};
  if (typeof estado.estagio === 'string' && estado.estagio) {
    stateFields.estagio_atual = estado.estagio;
  }
  if (typeof estado.proxima_acao === 'string' && estado.proxima_acao.trim()) {
    stateFields.proxima_acao = estado.proxima_acao.trim();
  }
  if (typeof estado.insistencias_valor === 'number' && Number.isFinite(estado.insistencias_valor)) {
    stateFields.insistencias_valor = Math.max(0, Math.min(3, Math.floor(estado.insistencias_valor)));
  }
  if (typeof estado.objetivo === 'string') {
    stateFields.objetivo = estado.objetivo;
  }
  if (typeof estado.modalidade === 'string') {
    stateFields.modalidade_recomendada = estado.modalidade;
  }
  if (typeof estado.disponibilidade === 'string') {
    stateFields.disponibilidade = estado.disponibilidade;
  }
  if (typeof estado.objecao_ativa === 'string') {
    stateFields.objecao_ativa = estado.objecao_ativa;
  }

  // Só define stateFields se houver pelo menos 1 campo — agent-v2 trata null como "tag esquecida"
  if (Object.keys(stateFields).length > 0) {
    out.stateFields = stateFields;
  }

  if (typeof estado.nome === 'string' && estado.nome.trim()) {
    out.nameFromTag = estado.nome.trim();
  }

  if (typeof input.modulo_proximo_turno === 'string') {
    const mod = input.modulo_proximo_turno.trim().toLowerCase();
    if (mod && mod !== 'nenhum') out.requiredModule = mod;
  }

  if (input.agendamento && typeof input.agendamento === 'object') {
    const ag = {};
    for (const k of ['nome', 'dia', 'hora', 'modalidade']) {
      if (typeof input.agendamento[k] === 'string' && input.agendamento[k].trim()) {
        ag[k] = input.agendamento[k].trim();
      }
    }
    if (Object.keys(ag).length > 0) out.agendamento = ag;
  }

  out.cleanText = sanitizeMensagem(input.mensagem_ao_lead);
  out.useAudio = input.responder_em_audio === true;
  out.askingForAudio = input.pedir_audio_ao_lead === true;

  return out;
}

module.exports = {
  TOOL_NAME,
  ESTAGIOS,
  OBJETIVOS,
  MODALIDADES,
  DISPONIBILIDADES,
  OBJECOES,
  MODULOS,
  buildToolDefinition,
  findAllToolUseBlocks,
  extractToolInput,
  toolInputToParsed,
  sanitizeMensagem,
  ADDENDUM_V3,
};
