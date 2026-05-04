// ═══════════════════════════════════════════════════════════════
// PERSONA V2 — identidade e tom da marca
// ═══════════════════════════════════════════════════════════════
//
// Persona controla COMO o agente soa e QUEM ele é. NÃO controla
// estrutura ou regras de venda — essas seguem no núcleo, imutáveis
// via UI (segurança).
//
// Slots editáveis:
//   - nomeAgente: nome do "dono"/atendente que se apresenta (ex: Johnny)
//   - nomeNegocio: nome do negócio (ex: STRONIX)
//   - descricaoJeito: 1-3 frases descrevendo o JEITO do agente
//                     (ex: "genuíno, caloroso, próximo, abre conversa
//                      com energia. Conhece todo mundo pelo nome.")
//   - abertura: 1ª frase da 1ª mensagem (saudação)
//   - giriasQuentes: substitutos pra frases performáticas
//   - giriasProibidas: frases que NUNCA devem aparecer
//   - frasesProibidasExtra: lista que admin pode engordar (opcional)
//
// O que NÃO fica em persona (continua no núcleo, imutável via UI):
//   - máquina de estado, regra dos valores, regras de ouro,
//     blacklist sistema, anti-padrão, checagem final, endereço
//
// assembleNucleoV2(persona) substitui placeholders {{PERSONA_*}} no
// núcleo. Default persona produz núcleo IDÊNTICO ao pré-persona.
//
// Snapshot: a cada save, persona ANTERIOR é guardada em
// agent_config.persona_previous. UI tem botão "↶ Voltar pra versão
// anterior" pra reverter (1 nível de undo, suficiente pra recuperar
// edição errada sem complicar).

const NUCLEO_V2_TEMPLATE = require('./prompt-nucleo-v2');
const db = require('./db');

// ─── Default persona — preserva conteúdo original do núcleo ───
const DEFAULT_PERSONA = Object.freeze({
  nomeAgente: 'Johnny',
  nomeNegocio: 'STRONIX',
  descricaoJeito: 'genuíno, sério, direto, sem papo de vendedor. Conhece todo mundo pelo nome. STRONIX é família, não academia de fisiculturista, "gente como a gente".',
  abertura: 'Opa beleza! Sou o Johnny da STRONIX 👋',
  // Binárias do roteiro — admin pode ajustar como cada pergunta é abordada,
  // mas a ESTRUTURA (sempre A ou B, sempre nesse estágio) continua fixa.
  binariaTreinando: 'Tu tá treinando ou parado?',
  binariaObjetivo: 'Mais resultado físico ou mais qualidade de vida no dia a dia?',
  binariaObjetivoDrill: 'ganhar massa ou emagrecer?',
  binariaNome: 'A propósito, como é teu nome?',
  binariaTurno: 'manhã ou final do dia?',
  binariaDia: 'Posso te encaixar terça ou quarta, qual rola pra ti?',
  binariaHora: 'Tem 9h ou 10h, qual prefere?',
  // Defletores quando lead pede valor (lógica fica fixa: passa só na 3ª).
  // Admin customiza só o JEITO de defletir.
  defletorValor1: 'Claro, já chegamos lá. Mas antes me conta...',
  defletorValor2: 'Bem rapidinho antes...',
  // Em qual insistência passa valor: 1 (imediato), 2 (após 1 defletor), 3 (atual — após 2 defletores).
  // Range 1-5. Defletor 2 só aparece se passa em 3+.
  passaValorEmInsistencia: 3,
  giriasQuentes: [
    'Bah',
    'Que legal',
    'Massa',
    'Tri',
    'Beleza',
    'Show',
    'Te entendo',
    'Sacou?',
    'Faz sentido',
  ],
  giriasProibidas: [
    'Excelente!',
    'Com certeza!',
    'Certamente!',
    'Absolutamente!',
    'Faz todo sentido!',
    'Entendo perfeitamente!',
    'Fico feliz em ajudar',
    'Ótimo objetivo!',
  ],
  frasesProibidasExtra: [],
});

// Limites defensivos (mesma filosofia do agent_config: clamp em vez de erro)
const LIMITS = {
  NOME_AGENTE_MAX: 60,
  NOME_NEGOCIO_MAX: 60,
  DESCRICAO_JEITO_MAX: 800,
  ABERTURA_MAX: 200,
  BINARIA_MAX: 200,
  ITEM_MAX: 200,
  LIST_MAX_ITEMS: 30,
  PASSA_VALOR_MIN: 1,
  PASSA_VALOR_MAX: 5,
};

function asString(val, fallback, maxLen) {
  if (typeof val !== 'string') return fallback;
  const t = val.trim();
  if (!t) return fallback;
  return t.slice(0, maxLen || LIMITS.ABERTURA_MAX);
}

function asInt(val, fallback, min, max) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function asStringList(val, fallback) {
  if (!Array.isArray(val)) return fallback;
  const cleaned = val
    .filter(x => typeof x === 'string')
    .map(x => x.trim())
    .filter(x => x.length > 0)
    .map(x => x.slice(0, LIMITS.ITEM_MAX))
    .slice(0, LIMITS.LIST_MAX_ITEMS);
  return cleaned;
}

// Normaliza persona parcial → persona completa (com defaults onde faltar).
function mergeWithDefaults(personaPartial) {
  const p = personaPartial || {};
  return {
    nomeAgente: asString(p.nomeAgente, DEFAULT_PERSONA.nomeAgente, LIMITS.NOME_AGENTE_MAX),
    nomeNegocio: asString(p.nomeNegocio, DEFAULT_PERSONA.nomeNegocio, LIMITS.NOME_NEGOCIO_MAX),
    descricaoJeito: asString(p.descricaoJeito, DEFAULT_PERSONA.descricaoJeito, LIMITS.DESCRICAO_JEITO_MAX),
    abertura: asString(p.abertura, DEFAULT_PERSONA.abertura, LIMITS.ABERTURA_MAX),
    binariaTreinando: asString(p.binariaTreinando, DEFAULT_PERSONA.binariaTreinando, LIMITS.BINARIA_MAX),
    binariaObjetivo: asString(p.binariaObjetivo, DEFAULT_PERSONA.binariaObjetivo, LIMITS.BINARIA_MAX),
    binariaObjetivoDrill: asString(p.binariaObjetivoDrill, DEFAULT_PERSONA.binariaObjetivoDrill, LIMITS.BINARIA_MAX),
    binariaNome: asString(p.binariaNome, DEFAULT_PERSONA.binariaNome, LIMITS.BINARIA_MAX),
    binariaTurno: asString(p.binariaTurno, DEFAULT_PERSONA.binariaTurno, LIMITS.BINARIA_MAX),
    binariaDia: asString(p.binariaDia, DEFAULT_PERSONA.binariaDia, LIMITS.BINARIA_MAX),
    binariaHora: asString(p.binariaHora, DEFAULT_PERSONA.binariaHora, LIMITS.BINARIA_MAX),
    defletorValor1: asString(p.defletorValor1, DEFAULT_PERSONA.defletorValor1, LIMITS.BINARIA_MAX),
    defletorValor2: asString(p.defletorValor2, DEFAULT_PERSONA.defletorValor2, LIMITS.BINARIA_MAX),
    passaValorEmInsistencia: asInt(p.passaValorEmInsistencia, DEFAULT_PERSONA.passaValorEmInsistencia, LIMITS.PASSA_VALOR_MIN, LIMITS.PASSA_VALOR_MAX),
    giriasQuentes: asStringList(p.giriasQuentes, DEFAULT_PERSONA.giriasQuentes.slice()),
    giriasProibidas: asStringList(p.giriasProibidas, DEFAULT_PERSONA.giriasProibidas.slice()),
    frasesProibidasExtra: asStringList(p.frasesProibidasExtra, DEFAULT_PERSONA.frasesProibidasExtra.slice()),
  };
}

// Renderiza array de strings como lista entre aspas separada por vírgula
// (estilo do núcleo original): ["Bah", "Show"] → "\"Bah\", \"Show\""
function formatQuotedList(items) {
  return items.map(s => `"${s}"`).join(', ');
}

// Bloco opcional pra frases proibidas extras (só aparece se admin
// preencheu). Evita poluir o prompt com seção vazia.
function buildFrasesProibidasExtraBlock(items) {
  if (!items || !items.length) return '';
  return `\n- PROIBIDO TAMBÉM (frases extras da marca): ${formatQuotedList(items)}.`;
}

// Constrói o bloco da REGRA DOS VALORES baseado em N (passa em qual insistência).
// N=1: passa imediato, sem defletores.
// N=2: 1 defletor (defletorValor1), depois apresenta.
// N=3 (default): 2 defletores, depois apresenta.
// N=4 e N=5: defletor1 nas iniciais, defletor2 na penúltima, apresenta na N.
function buildRegraDosValoresBlock(persona) {
  const N = persona.passaValorEmInsistencia;
  const apresenta = `→ estagio=apresentacao_planos. Peça [MODULO_REQUERIDO:planos_e_precos]. Apresente do MAIS CARO pro MAIS BARATO.`;
  const lines = [];
  if (N === 1) {
    lines.push(`- insistencias_valor=1 ${apresenta}`);
  } else if (N === 2) {
    lines.push(`- insistencias_valor=1 → "${persona.defletorValor1}" + pergunta da fase atual.`);
    lines.push(`- insistencias_valor=2 ${apresenta}`);
  } else {
    // N >= 3: defletor1 nas primeiras (N-2), defletor2 na (N-1), apresenta na N.
    for (let i = 1; i <= N - 2; i++) {
      lines.push(`- insistencias_valor=${i} → "${persona.defletorValor1}" + pergunta da fase atual.`);
    }
    lines.push(`- insistencias_valor=${N - 1} → "${persona.defletorValor2}" + drill da fase atual.`);
    lines.push(`- insistencias_valor=${N} ${apresenta}`);
  }
  lines.push(`- Lead RESPONDEU as perguntas E NUNCA REPETIU pedido de valor? NÃO PASSE VALOR. Continue o roteiro.`);
  return lines.join('\n');
}

// ─── ASSEMBLE ───
// Pega persona (parcial ou completa), normaliza, substitui placeholders
// no núcleo. Pure function — sem I/O. Retorna a string final do prompt.
function assembleNucleoV2(personaPartial) {
  const persona = mergeWithDefaults(personaPartial);
  const out = NUCLEO_V2_TEMPLATE
    .replace(/\{\{PERSONA_NOME_AGENTE_UPPER\}\}/g, persona.nomeAgente.toUpperCase())
    .replace(/\{\{PERSONA_NOME_NEGOCIO_UPPER\}\}/g, persona.nomeNegocio.toUpperCase())
    .replace(/\{\{PERSONA_NOME_AGENTE\}\}/g, persona.nomeAgente)
    .replace(/\{\{PERSONA_NOME_NEGOCIO\}\}/g, persona.nomeNegocio)
    .replace(/\{\{PERSONA_DESCRICAO_JEITO\}\}/g, persona.descricaoJeito)
    .replace(/\{\{PERSONA_ABERTURA\}\}/g, persona.abertura)
    .replace(/\{\{PERSONA_BINARIA_TREINANDO\}\}/g, persona.binariaTreinando)
    .replace(/\{\{PERSONA_BINARIA_OBJETIVO_DRILL\}\}/g, persona.binariaObjetivoDrill)
    .replace(/\{\{PERSONA_BINARIA_OBJETIVO\}\}/g, persona.binariaObjetivo)
    .replace(/\{\{PERSONA_BINARIA_NOME\}\}/g, persona.binariaNome)
    .replace(/\{\{PERSONA_BINARIA_TURNO\}\}/g, persona.binariaTurno)
    .replace(/\{\{PERSONA_BINARIA_DIA\}\}/g, persona.binariaDia)
    .replace(/\{\{PERSONA_BINARIA_HORA\}\}/g, persona.binariaHora)
    .replace(/\{\{PERSONA_REGRA_VALORES_BLOCK\}\}/g, buildRegraDosValoresBlock(persona))
    .replace(/\{\{PERSONA_PASSA_VALOR_EM\}\}/g, String(persona.passaValorEmInsistencia))
    .replace(/\{\{PERSONA_GIRIAS_QUENTES\}\}/g, formatQuotedList(persona.giriasQuentes))
    .replace(/\{\{PERSONA_GIRIAS_PROIBIDAS\}\}/g, formatQuotedList(persona.giriasProibidas))
    .replace(/\{\{PERSONA_FRASES_PROIBIDAS_EXTRA_BLOCK\}\}/g, buildFrasesProibidasExtraBlock(persona.frasesProibidasExtra));
  return out;
}

// ─── DB I/O ───
// Persona é guardada como JSON em agent_config.persona. Lê/grava via
// helpers já existentes (getAgentConfig/setAgentConfig).
// Snapshot pra undo: persona ANTERIOR fica em agent_config.persona_previous.
const AGENT_CONFIG_KEY = 'persona';
const AGENT_CONFIG_PREV_KEY = 'persona_previous';

function freshDefault() {
  return {
    ...DEFAULT_PERSONA,
    giriasQuentes: DEFAULT_PERSONA.giriasQuentes.slice(),
    giriasProibidas: DEFAULT_PERSONA.giriasProibidas.slice(),
    frasesProibidasExtra: [],
  };
}

function readPersonaFromKey(key) {
  const raw = db.getAgentConfig(key, null);
  if (!raw) return null;
  try {
    return mergeWithDefaults(JSON.parse(raw));
  } catch (e) {
    console.warn(`[persona-v2] ${key} no DB inválido, ignorando:`, e.message);
    return null;
  }
}

function getPersona() {
  return readPersonaFromKey(AGENT_CONFIG_KEY) || freshDefault();
}

function getPreviousPersona() {
  return readPersonaFromKey(AGENT_CONFIG_PREV_KEY);
}

function setPersona(personaPartial, userId = null) {
  const normalized = mergeWithDefaults(personaPartial);
  // Antes de gravar a nova, salva a atual como "previous" (undo).
  // Só salva snapshot se a persona atual estiver setada (i.e. é custom);
  // se não, "previous=default" = nada útil de reverter.
  const currentRaw = db.getAgentConfig(AGENT_CONFIG_KEY, null);
  if (currentRaw) {
    db.setAgentConfig(AGENT_CONFIG_PREV_KEY, currentRaw, userId);
  }
  db.setAgentConfig(AGENT_CONFIG_KEY, JSON.stringify(normalized), userId);
  return normalized;
}

function resetPersona(userId = null) {
  // Snapshot da custom antes de resetar (permite undo do reset)
  const currentRaw = db.getAgentConfig(AGENT_CONFIG_KEY, null);
  if (currentRaw) {
    db.setAgentConfig(AGENT_CONFIG_PREV_KEY, currentRaw, userId);
  }
  db.setAgentConfig(AGENT_CONFIG_KEY, null, userId);
}

function revertPersona(userId = null) {
  const prev = readPersonaFromKey(AGENT_CONFIG_PREV_KEY);
  if (!prev) return null;
  // Swap: previous vira current, current vira previous (undo de undo).
  const currentRaw = db.getAgentConfig(AGENT_CONFIG_KEY, null);
  db.setAgentConfig(AGENT_CONFIG_KEY, JSON.stringify(prev), userId);
  if (currentRaw) {
    db.setAgentConfig(AGENT_CONFIG_PREV_KEY, currentRaw, userId);
  } else {
    db.setAgentConfig(AGENT_CONFIG_PREV_KEY, null, userId);
  }
  return prev;
}

function isPersonaCustom() {
  return db.getAgentConfig(AGENT_CONFIG_KEY, null) !== null;
}

function hasPreviousPersona() {
  return db.getAgentConfig(AGENT_CONFIG_PREV_KEY, null) !== null;
}

module.exports = {
  DEFAULT_PERSONA,
  LIMITS,
  assembleNucleoV2,
  mergeWithDefaults,
  getPersona,
  getPreviousPersona,
  setPersona,
  resetPersona,
  revertPersona,
  isPersonaCustom,
  hasPreviousPersona,
};
