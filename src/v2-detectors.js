// ═══════════════════════════════════════════════════════════════
// V2 DETECTORS — sanity checks pra alimentar v2_metrics_log
// ═══════════════════════════════════════════════════════════════
//
// PR #37. Funções puras (sem I/O) usadas pela instrumentação do replyV2
// pra detectar comportamentos suspeitos do bot. Falsos positivos são
// aceitos — admin tem botão "marcar como falso alarme" no painel.
//
// Cada detector retorna { triggered, reason, context } pra fácil log.

// ─── Regex pra capturar valores monetários no texto ───
// Cobre: R$199, R$ 199, R$ 199,90, R$199.00, 199 reais, 199,90 reais
const MONEY_RE = /(?:R\$\s*([\d]{1,4}(?:[.,]\d{1,2})?)|\b([\d]{2,4}(?:[.,]\d{1,2})?)\s*reais?\b)/gi;

// Extrai todos os valores numéricos mencionados como dinheiro.
// Retorna array de números (inteiros ou floats).
function extractMoneyValues(text) {
  if (!text) return [];
  const out = [];
  let m;
  // Reset lastIndex porque regex tem flag /g
  MONEY_RE.lastIndex = 0;
  while ((m = MONEY_RE.exec(text)) !== null) {
    const raw = (m[1] || m[2] || '').replace(',', '.');
    const n = parseFloat(raw);
    if (!isNaN(n) && n > 0 && n < 100000) out.push(n);
  }
  return out;
}

// Whitelist de derivações matemáticas comuns que NÃO contam como invenção.
// Bot às vezes diz "R$ 3,60 por dia" derivado de R$109/30. Aceitar.
function isLikelyDerivation(value, valoresOficiais) {
  if (value < 1) return true; // valores < R$1 são quase sempre derivações por dia/hora
  // Se o valor é < 10% do menor preço oficial, provavelmente é "por dia/hora"
  const menorOficial = Math.min(...valoresOficiais);
  if (menorOficial > 0 && value < menorOficial * 0.15) return true;
  // Tolerância de ±5% (arredondamentos / formatação)
  for (const ofc of valoresOficiais) {
    if (Math.abs(value - ofc) / ofc < 0.05) return true;
  }
  return false;
}

// Detecta se a resposta do bot inventou preço fora dos oficiais.
// `precosOficiais`: array de números vindos do academia_info (planos, matrícula, etc).
function detectsPrecoInventado(text, precosOficiais) {
  if (!text || !Array.isArray(precosOficiais) || !precosOficiais.length) {
    return { triggered: false, reason: 'sem precos oficiais pra comparar', context: null };
  }
  const mencionados = extractMoneyValues(text);
  if (!mencionados.length) {
    return { triggered: false, reason: 'sem valor mencionado', context: null };
  }
  const inventados = mencionados.filter(v => !isLikelyDerivation(v, precosOficiais));
  if (!inventados.length) {
    return { triggered: false, reason: 'todos os valores conferem ou são derivações', context: { mencionados } };
  }
  return {
    triggered: true,
    reason: `valores não encontrados em academia_info: ${inventados.join(', ')}`,
    context: { inventados, mencionados, oficiais: precosOficiais },
  };
}

// Detecta se bot passou valor sem ter atingido a 3ª insistência.
// Regra do núcleo v2: só passa tabela em `apresentacao_planos` (= insistencias_valor=3).
function detectsValorAntecipado(text, insistenciasValor) {
  const mencionados = extractMoneyValues(text);
  if (!mencionados.length) {
    return { triggered: false, reason: 'sem valor mencionado', context: null };
  }
  // Filtra valores muito baixos (provável derivação por dia / referência genérica)
  const valoresReais = mencionados.filter(v => v >= 50);
  if (!valoresReais.length) {
    return { triggered: false, reason: 'só valores derivados (<R$50)', context: { mencionados } };
  }
  if ((insistenciasValor || 0) >= 3) {
    return { triggered: false, reason: 'insistencias_valor já em 3+', context: null };
  }
  return {
    triggered: true,
    reason: `bot passou valor (${valoresReais.join(', ')}) com insistencias_valor=${insistenciasValor || 0}`,
    context: { valores: valoresReais, insistencias: insistenciasValor || 0 },
  };
}

// Detecta se a resposta NÃO veio com tag [ESTADO:] (parsed.stateFields é null).
// Wrapper trivial pra padronizar formato.
function detectsTagEsquecida(parsed) {
  const triggered = !parsed || parsed.stateFields === null;
  return {
    triggered,
    reason: triggered ? 'parsed.stateFields é null' : 'tag presente',
    context: null,
  };
}

// Extrai valores numéricos de academia_info (chaves contendo "valor" ou "preco").
// `infoMap` é o output de db.getAcademiaInfoMap() — { key: value }.
function extractPrecosOficiaisFromAcademiaInfo(infoMap) {
  if (!infoMap || typeof infoMap !== 'object') return [];
  const valores = new Set();
  for (const [key, val] of Object.entries(infoMap)) {
    if (!val) continue;
    if (!/valor|preco|preço|matricula|matrícula|investimento/i.test(key)) continue;
    const found = extractMoneyValues(String(val));
    for (const v of found) valores.add(v);
  }
  return Array.from(valores);
}

module.exports = {
  extractMoneyValues,
  isLikelyDerivation,
  detectsPrecoInventado,
  detectsValorAntecipado,
  detectsTagEsquecida,
  extractPrecosOficiaisFromAcademiaInfo,
  MONEY_RE,
};
