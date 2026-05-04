// ═══════════════════════════════════════════════════════════════
// V3-VALIDATORS — Validação cruzada de preço (PR2 da migração v3)
// ═══════════════════════════════════════════════════════════════
//
// Mata hallucination de preço por construção. Em vez de o detector regex
// pegar o problema POST-FACTO (PR37 detectsPrecoInventado), o agent v3:
//   1. Força o modelo a declarar `planos_referenciados` no input da tool
//      quando cita valor monetário em mensagem_ao_lead.
//   2. Backend cruza: cada R$ na mensagem precisa bater ±5% com preço
//      OFICIAL de algum plano referenciado.
//   3. Se não bater: 1 retry forçado via `tool_result` com hint corretivo.
//   4. Se segundo retry também falhar: log + envia resposta original.
//
// Source of truth de PREÇO: módulo `prompt_modules.planos_e_precos` no DB.
// (Decisão PR61: preço fica SÓ em módulos, não em academia_info.)
//
// Reuso: `extractMoneyValues` de v2-detectors.js (mesmo regex).

const db = require('./db');
const { extractMoneyValues } = require('./v2-detectors');

// Tolerância ±5% pra acomodar arredondamento ("199 ≈ 200") e citações
// imprecisas. Mesmo valor usado em v2-detectors.js detectsPrecoInventado.
const TOLERANCE = 0.05;

// Valores < 50 são tratados como derivações (R$3,60/dia, R$1,50/aula, etc.)
// e ignorados pela validação. Mesmo limiar do v2.
const MIN_VALOR_VALIDADO = 50;

// ─────────────────────────────────────────────────────────────────────
// PARSER — extrai { plano_id: {price, modalidade, plano_nome} } do
// conteúdo do módulo `planos_e_precos`. Defensivo: linha malformada
// é ignorada, parser nunca lança. Retorna {} se conteúdo inválido.
// ─────────────────────────────────────────────────────────────────────

// Normaliza string pra snake_case sem acento. "MUSCULAÇÃO" → "musculacao".
function normalizeId(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Mapeia nome do plano (Flex, No Limit, Clube + Start/Flow/Move) pro suffix
// canônico do plano_id. "Clube + X" sempre vira "clube" — variantes (Start,
// Flow, Move) são modalidade-específicas mas o plano_id agrupa.
function planoNomeToSuffix(nome) {
  const n = String(nome || '').trim().toLowerCase();
  if (/^flex\b/.test(n)) return 'flex';
  if (/^no\s+limit\b/.test(n)) return 'no_limit';
  if (/^clube\b/.test(n)) return 'clube';
  return null;
}

function parsePlanosFromModule(content) {
  if (typeof content !== 'string' || !content.trim()) return {};

  const out = {};
  let modalidadeAtual = null;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    // Header de modalidade: "MUSCULAÇÃO", "PILATES", "PERSONALIZADO"
    // Aceita maiúsculas com/sem acento. Linha sem outro conteúdo após.
    const modaMatch = line.match(/^(MUSCULA[ÇC][ÃA]O|PILATES|PERSONALIZADO)\s*$/i);
    if (modaMatch) {
      modalidadeAtual = normalizeId(modaMatch[1]);
      continue;
    }

    if (!modalidadeAtual) continue;

    // Linha de plano: "- Plano <Nome>: R$<valor>/mês ..."
    // Aceita "R$199" e "R$ 199" e "R$199,50".
    const planoMatch = line.match(/^-\s*(?:Plano\s+)?(.+?):\s*R\$\s*(\d+(?:[.,]\d+)?)/i);
    if (!planoMatch) continue;

    const planoNome = planoMatch[1].trim();
    const priceStr = planoMatch[2].replace(',', '.');
    const price = parseFloat(priceStr);
    if (!Number.isFinite(price) || price <= 0) continue;

    const suffix = planoNomeToSuffix(planoNome);
    if (!suffix) continue;

    const planoId = `${modalidadeAtual}_${suffix}`;
    // Não sobrescreve — primeiro match vence (defesa contra duplicata no módulo)
    if (!out[planoId]) {
      out[planoId] = { price, modalidade: modalidadeAtual, plano_nome: planoNome };
    }
  }

  // Matrícula: extrai do primeiro "+ R$<valor> matrícula" que aparecer.
  // Fallback estático R$99 se não achar (valor canônico do projeto).
  const matriculaMatch = content.match(/R\$\s*(\d+(?:[.,]\d+)?)\s+matr[íi]cula/i);
  if (matriculaMatch) {
    const price = parseFloat(matriculaMatch[1].replace(',', '.'));
    if (Number.isFinite(price) && price > 0) {
      out.matricula = { price, modalidade: 'todas', plano_nome: 'Matrícula' };
    }
  }

  return out;
}

// Lê o módulo planos_e_precos do DB e parseia. Retorna {} se o módulo
// não existir, estiver inativo, ou parser falhar. Validador trata `{}` como
// "sem fonte oficial" e pula a validação (fail-safe).
function getPlanosCanonicos() {
  try {
    const mod = db.getPromptModule('planos_e_precos');
    if (!mod || !mod.content) return {};
    return parsePlanosFromModule(mod.content);
  } catch (err) {
    console.warn('[v3-validators] falha ao carregar planos:', err.message);
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────
// VALIDADOR — cruza valores monetários em mensagem_ao_lead com os
// preços oficiais dos plano_ids declarados em planos_referenciados.
// Pure: sem I/O. Caller injeta `planoPrecos` (geralmente getPlanosCanonicos()).
// ─────────────────────────────────────────────────────────────────────

function isWithinTolerance(value, target) {
  if (!Number.isFinite(value) || !Number.isFinite(target) || target <= 0) return false;
  return Math.abs(value - target) / target <= TOLERANCE;
}

// Retorna: { valid, mismatches, referenciados, valoresEncontrados, reason? }.
// valid=true quando: (a) sem valores ≥R$50 na mensagem, OU (b) todo valor
// bate ±5% com preço de algum plano em planos_referenciados.
//
// valid=false em 3 cenários:
//   - mensagem cita valor mas planos_referenciados está vazio (`reason='referencia_vazia'`)
//   - planos_referenciados contém ID(s) sem preço oficial (`reason='plano_id_sem_preco'`)
//     → trata como falha pra forçar correção (caso raro, indica enum desalinhado)
//   - valor da mensagem não bate com nenhum preço referenciado (`reason='valor_nao_bate'`)
function validatePrecosNaMensagem({ mensagem, planosReferenciados, planoPrecos }) {
  const valoresEncontrados = (extractMoneyValues(mensagem || '') || [])
    .filter(v => Number.isFinite(v) && v >= MIN_VALOR_VALIDADO);

  // Sem valor monetário relevante → válido independente de planos_referenciados
  if (valoresEncontrados.length === 0) {
    return {
      valid: true,
      mismatches: [],
      referenciados: planosReferenciados || [],
      valoresEncontrados: [],
    };
  }

  // Tem valor mas não declarou plano referenciado → reprovado
  if (!Array.isArray(planosReferenciados) || planosReferenciados.length === 0) {
    return {
      valid: false,
      reason: 'referencia_vazia',
      mismatches: valoresEncontrados.map(v => ({ valor: v, esperados: [] })),
      referenciados: [],
      valoresEncontrados,
    };
  }

  // Coleta preços aceitáveis (dos planos referenciados)
  const acceptableMap = []; // [{plano_id, price}]
  const planoIdsSemPreco = [];
  for (const planoId of planosReferenciados) {
    if (typeof planoId !== 'string') continue;
    const entry = planoPrecos && planoPrecos[planoId];
    if (entry && Number.isFinite(entry.price)) {
      acceptableMap.push({ plano_id: planoId, price: entry.price });
    } else {
      planoIdsSemPreco.push(planoId);
    }
  }

  if (acceptableMap.length === 0) {
    return {
      valid: false,
      reason: 'plano_id_sem_preco',
      mismatches: valoresEncontrados.map(v => ({ valor: v, esperados: [] })),
      referenciados: planosReferenciados,
      valoresEncontrados,
      planoIdsSemPreco,
    };
  }

  // Cada valor precisa bater com pelo menos um preço aceitável
  const mismatches = [];
  for (const v of valoresEncontrados) {
    const matched = acceptableMap.some(({ price }) => isWithinTolerance(v, price));
    if (!matched) {
      mismatches.push({
        valor: v,
        esperados: acceptableMap.map(a => ({ plano_id: a.plano_id, price: a.price })),
      });
    }
  }

  if (mismatches.length === 0) {
    return {
      valid: true,
      mismatches: [],
      referenciados: planosReferenciados,
      valoresEncontrados,
    };
  }

  return {
    valid: false,
    reason: 'valor_nao_bate',
    mismatches,
    referenciados: planosReferenciados,
    valoresEncontrados,
  };
}

// ─────────────────────────────────────────────────────────────────────
// HINT PRO RETRY — string injetada como `tool_result` (is_error=true)
// no canal Anthropic. Modelo lê e regenera a tool com correção.
// Curto e específico — quanto mais informação, melhor a correção.
// ─────────────────────────────────────────────────────────────────────

function buildRetryHint(validation, planoPrecos) {
  const lines = ['VALIDAÇÃO BACKEND REPROVOU — corrija a chamada da tool:'];

  if (validation.reason === 'referencia_vazia') {
    lines.push(
      `Tu citou valor(es) ${validation.valoresEncontrados.map(v => `R$${v}`).join(', ')} ` +
      `em mensagem_ao_lead mas deixou planos_referenciados=[]. ` +
      `Liste o(s) plano_id(s) cujos preços tu citou.`
    );
  } else if (validation.reason === 'plano_id_sem_preco') {
    lines.push(
      `Os plano_ids ${JSON.stringify(validation.planoIdsSemPreco)} não têm preço oficial conhecido. ` +
      `Use plano_ids válidos ou remova os valores da mensagem.`
    );
  } else if (validation.reason === 'valor_nao_bate') {
    for (const m of validation.mismatches) {
      const esperados = m.esperados.map(e => `${e.plano_id}=R$${e.price}`).join(', ');
      lines.push(`R$${m.valor} citado, mas planos referenciados são: ${esperados}.`);
    }
    lines.push('Corrija o valor pra bater com o plano referenciado, OU referencie o plano correto pro valor.');
  }

  // Apêndice: tabela completa de preços oficiais (10 entries) pra ajudar o modelo.
  if (planoPrecos && Object.keys(planoPrecos).length > 0) {
    lines.push('');
    lines.push('Tabela oficial:');
    for (const [id, info] of Object.entries(planoPrecos)) {
      lines.push(`  ${id} = R$${info.price}`);
    }
  }

  return lines.join('\n');
}

module.exports = {
  TOLERANCE,
  MIN_VALOR_VALIDADO,
  parsePlanosFromModule,
  getPlanosCanonicos,
  validatePrecosNaMensagem,
  buildRetryHint,
  isWithinTolerance,
  normalizeId,
  planoNomeToSuffix,
};
