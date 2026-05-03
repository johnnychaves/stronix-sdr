// ═══════════════════════════════════════════════════════════════
// PERSONA V2 — voz e tom da marca (gírias, abertura, frases)
// ═══════════════════════════════════════════════════════════════
//
// Persona é o subconjunto do núcleo v2 que trata APENAS de TOM (como
// soa), NÃO de estrutura ou regras de venda. Admin edita persona via
// painel pra ajustar voz da marca sem risco de quebrar a IA.
//
// Slots seguros:
//   - abertura: 1ª frase da 1ª mensagem
//   - giriasQuentes: substitutos pra frases performáticas
//   - giriasProibidas: frases que NUNCA devem aparecer
//   - frasesProibidasExtra: lista que admin pode engordar (opcional)
//
// O que NÃO fica em persona (continua no núcleo, imutável via UI):
//   - máquina de estado, regra dos valores, regras de ouro,
//     blacklist sistema, anti-padrão, checagem final, etc.
//
// assembleNucleoV2(persona) substitui placeholders {{PERSONA_*}} no
// núcleo. Default persona produz núcleo IDÊNTICO ao pré-persona.

const NUCLEO_V2_TEMPLATE = require('./prompt-nucleo-v2');
const db = require('./db');

// ─── Default persona — preserva conteúdo original do núcleo ───
const DEFAULT_PERSONA = Object.freeze({
  abertura: 'Opa beleza! Sou o Johnny da STRONIX 👋',
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
  ABERTURA_MAX: 200,
  ITEM_MAX: 200,
  LIST_MAX_ITEMS: 30,
};

function asString(val, fallback) {
  if (typeof val !== 'string') return fallback;
  const t = val.trim();
  if (!t) return fallback;
  return t.slice(0, LIMITS.ABERTURA_MAX);
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
    abertura: asString(p.abertura, DEFAULT_PERSONA.abertura),
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

// ─── ASSEMBLE ───
// Pega persona (parcial ou completa), normaliza, substitui placeholders
// no núcleo. Pure function — sem I/O. Retorna a string final do prompt.
function assembleNucleoV2(personaPartial) {
  const persona = mergeWithDefaults(personaPartial);
  const out = NUCLEO_V2_TEMPLATE
    .replace(/\{\{PERSONA_ABERTURA\}\}/g, persona.abertura)
    .replace(/\{\{PERSONA_GIRIAS_QUENTES\}\}/g, formatQuotedList(persona.giriasQuentes))
    .replace(/\{\{PERSONA_GIRIAS_PROIBIDAS\}\}/g, formatQuotedList(persona.giriasProibidas))
    .replace(/\{\{PERSONA_FRASES_PROIBIDAS_EXTRA_BLOCK\}\}/g, buildFrasesProibidasExtraBlock(persona.frasesProibidasExtra));
  return out;
}

// ─── DB I/O ───
// Persona é guardada como JSON em agent_config.persona. Lê/grava via
// helpers já existentes (getAgentConfig/setAgentConfig).
const AGENT_CONFIG_KEY = 'persona';

function getPersona() {
  const raw = db.getAgentConfig(AGENT_CONFIG_KEY, null);
  if (!raw) return { ...DEFAULT_PERSONA, giriasQuentes: DEFAULT_PERSONA.giriasQuentes.slice(), giriasProibidas: DEFAULT_PERSONA.giriasProibidas.slice(), frasesProibidasExtra: [] };
  try {
    const parsed = JSON.parse(raw);
    return mergeWithDefaults(parsed);
  } catch (e) {
    console.warn('[persona-v2] persona no DB inválido, usando default:', e.message);
    return { ...DEFAULT_PERSONA, giriasQuentes: DEFAULT_PERSONA.giriasQuentes.slice(), giriasProibidas: DEFAULT_PERSONA.giriasProibidas.slice(), frasesProibidasExtra: [] };
  }
}

function setPersona(personaPartial, userId = null) {
  const normalized = mergeWithDefaults(personaPartial);
  db.setAgentConfig(AGENT_CONFIG_KEY, JSON.stringify(normalized), userId);
  return normalized;
}

function resetPersona(userId = null) {
  db.setAgentConfig(AGENT_CONFIG_KEY, null, userId);
}

function isPersonaCustom() {
  return db.getAgentConfig(AGENT_CONFIG_KEY, null) !== null;
}

module.exports = {
  DEFAULT_PERSONA,
  LIMITS,
  assembleNucleoV2,
  mergeWithDefaults,
  getPersona,
  setPersona,
  resetPersona,
  isPersonaCustom,
};
