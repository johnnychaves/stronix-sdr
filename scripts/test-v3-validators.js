#!/usr/bin/env node
// Testes unitários do PR2 da migração v3 — validator de preço cruzado com
// planos_referenciados. Cobre: parser de módulo, lookup de preço oficial,
// validação por tolerância ±5%, retry hint generator. Roda offline, sub-100ms.

const {
  TOLERANCE,
  MIN_VALOR_VALIDADO,
  parsePlanosFromModule,
  validatePrecosNaMensagem,
  buildRetryHint,
  isWithinTolerance,
  normalizeId,
  planoNomeToSuffix,
} = require('../src/v3-validators');

let pass = 0, fail = 0;
function assert(cond, name, detail) {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}${detail ? '\n  ' + detail : ''}`); }
}

// ─────────────────────────────────────────────────────────────────────
// 1. NORMALIZAÇÃO DE IDs (utils internos)
// ─────────────────────────────────────────────────────────────────────

assert(normalizeId('MUSCULAÇÃO') === 'musculacao', 'normalizeId remove acento + caps');
assert(normalizeId('  Pilates  ') === 'pilates', 'normalizeId trim + lower');
assert(normalizeId('') === '', 'normalizeId vazio');
assert(normalizeId(null) === '', 'normalizeId null safe');

assert(planoNomeToSuffix('Flex') === 'flex', 'plano nome Flex → flex');
assert(planoNomeToSuffix('No Limit') === 'no_limit', 'plano nome No Limit → no_limit');
assert(planoNomeToSuffix('Clube + Start') === 'clube', 'plano nome Clube + Start → clube');
assert(planoNomeToSuffix('Clube + Flow') === 'clube', 'plano nome Clube + Flow → clube');
assert(planoNomeToSuffix('Clube + Move') === 'clube', 'plano nome Clube + Move → clube');
assert(planoNomeToSuffix('Algum Inventado') === null, 'plano desconhecido → null');

// ─────────────────────────────────────────────────────────────────────
// 2. PARSER DE MÓDULO — formato real do prompt-modules-seed.js
// ─────────────────────────────────────────────────────────────────────

const MODULO_REAL = `GATILHO: estagio=apresentacao_planos.

CONTEÚDO:

MUSCULAÇÃO
- Plano Flex: R$199/mês + R$99 matrícula (1 mês avulso, sem fidelidade)
- Plano No Limit: R$149/mês + R$99 matrícula (recorrência mensal cartão, fidelidade 12 meses)
- Plano Clube + Start: R$109/mês + matrícula isenta (12 meses upfront, benefícios exclusivos)

PILATES
- Plano Flex: R$319/mês + R$99 matrícula
- Plano No Limit: R$279/mês + R$99 matrícula
- Plano Clube + Flow: R$249/mês + matrícula isenta

PERSONALIZADO
- Plano Flex: R$279/mês + R$99 matrícula
- Plano No Limit: R$239/mês + R$99 matrícula
- Plano Clube + Move: R$199/mês + matrícula isenta

LÓGICA DOS PLANOS
- Flex: o mais caro, sem fidelidade.
`;

const planos = parsePlanosFromModule(MODULO_REAL);

assert(Object.keys(planos).length === 10, 'parser extrai 10 plano_ids (9 planos + matricula)', `got ${Object.keys(planos).length}: ${Object.keys(planos).join(',')}`);
assert(planos.musculacao_flex && planos.musculacao_flex.price === 199, 'musculacao_flex = R$199');
assert(planos.musculacao_no_limit && planos.musculacao_no_limit.price === 149, 'musculacao_no_limit = R$149');
assert(planos.musculacao_clube && planos.musculacao_clube.price === 109, 'musculacao_clube (Clube + Start) = R$109');
assert(planos.pilates_flex && planos.pilates_flex.price === 319, 'pilates_flex = R$319');
assert(planos.pilates_no_limit && planos.pilates_no_limit.price === 279, 'pilates_no_limit = R$279');
assert(planos.pilates_clube && planos.pilates_clube.price === 249, 'pilates_clube (Clube + Flow) = R$249');
assert(planos.personalizado_flex && planos.personalizado_flex.price === 279, 'personalizado_flex = R$279');
assert(planos.personalizado_no_limit && planos.personalizado_no_limit.price === 239, 'personalizado_no_limit = R$239');
assert(planos.personalizado_clube && planos.personalizado_clube.price === 199, 'personalizado_clube (Clube + Move) = R$199');
assert(planos.matricula && planos.matricula.price === 99, 'matricula extraída do "+ R$99 matrícula"');

assert(planos.musculacao_flex.modalidade === 'musculacao', 'guarda modalidade no entry');
// Parser strip "Plano " do começo (regex `(?:Plano\s+)?` é opcional e consome quando presente)
assert(planos.musculacao_flex.plano_nome === 'Flex', 'guarda plano_nome no entry (sem prefixo "Plano")');
assert(planos.musculacao_clube.plano_nome === 'Clube + Start', 'plano_nome preserva variante (Start/Flow/Move)');

// ─── Defesa contra módulo malformado ───
assert(Object.keys(parsePlanosFromModule('')).length === 0, 'parser conteúdo vazio → {}');
assert(Object.keys(parsePlanosFromModule(null)).length === 0, 'parser null safe');
assert(Object.keys(parsePlanosFromModule(undefined)).length === 0, 'parser undefined safe');
assert(Object.keys(parsePlanosFromModule(123)).length === 0, 'parser tipo errado safe');
assert(Object.keys(parsePlanosFromModule('texto sem estrutura')).length === 0, 'parser texto qualquer → {}');

// Modalidade sem planos abaixo
const SEM_PLANOS = 'MUSCULAÇÃO\n\nLÓGICA';
assert(Object.keys(parsePlanosFromModule(SEM_PLANOS)).length === 0, 'modalidade sem planos abaixo → {}');

// Linha malformada não derruba parser
const MALFORMADO = `MUSCULAÇÃO
- Plano Flex: R$199/mês
- linha quebrada sem preço
- Plano No Limit: NAO É NUMERO
- Plano Clube + Start: R$109/mês`;
const parsedMalformado = parsePlanosFromModule(MALFORMADO);
assert(
  parsedMalformado.musculacao_flex && parsedMalformado.musculacao_clube && !parsedMalformado.musculacao_no_limit,
  'parser pula linhas malformadas, pega válidas'
);

// ─────────────────────────────────────────────────────────────────────
// 3. isWithinTolerance — ±5% padrão
// ─────────────────────────────────────────────────────────────────────

assert(isWithinTolerance(199, 199) === true, '199 ↔ 199 (exato)');
assert(isWithinTolerance(200, 199) === true, '200 ↔ 199 (~0.5% delta)');
assert(isWithinTolerance(190, 199) === true, '190 ↔ 199 (~4.5% — dentro)');
assert(isWithinTolerance(189, 199) === false, '189 ↔ 199 (~5.03% — fora)');
assert(isWithinTolerance(180, 199) === false, '180 ↔ 199 (~9.5% — fora)');
assert(isWithinTolerance(149, 199) === false, '149 ↔ 199 (~25% — fora)');
assert(isWithinTolerance(NaN, 199) === false, 'NaN safe');
assert(isWithinTolerance(199, 0) === false, 'target=0 evita div by zero');
assert(isWithinTolerance(199, -1) === false, 'target negativo safe');

// ─────────────────────────────────────────────────────────────────────
// 4. validatePrecosNaMensagem — caso feliz
// ─────────────────────────────────────────────────────────────────────

const planoPrecos = planos; // usa o map parseado

// Mensagem sem valor → válido independente de planos_referenciados
assert(
  validatePrecosNaMensagem({
    mensagem: 'Beleza, agendado terça às 9h',
    planosReferenciados: [],
    planoPrecos,
  }).valid === true,
  'sem valor monetário → valid (planos_referenciados vazio é OK)'
);
assert(
  validatePrecosNaMensagem({
    mensagem: 'Beleza, agendado terça às 9h',
    planosReferenciados: ['musculacao_flex'],
    planoPrecos,
  }).valid === true,
  'sem valor → valid mesmo com planos_referenciados preenchido'
);

// Valor pequeno (< 50) → ignorado (derivação tipo "R$3,60/dia")
assert(
  validatePrecosNaMensagem({
    mensagem: 'Sai R$3,60 por dia se dividir',
    planosReferenciados: [],
    planoPrecos,
  }).valid === true,
  'R$3,60 (< MIN_VALOR_VALIDADO) → válido sem referência'
);

// Valor exato bate
assert(
  validatePrecosNaMensagem({
    mensagem: 'O Flex de musculação é R$199/mês',
    planosReferenciados: ['musculacao_flex'],
    planoPrecos,
  }).valid === true,
  'R$199 + ref musculacao_flex(199) → valid'
);

// Valor dentro da tolerância
assert(
  validatePrecosNaMensagem({
    mensagem: 'Em torno de R$200 por mês',
    planosReferenciados: ['musculacao_flex'],
    planoPrecos,
  }).valid === true,
  'R$200 + ref musculacao_flex(199) (dentro 5%) → valid'
);

// Múltiplos valores + múltiplas referências (cada valor bate em pelo menos 1 ref)
const multiOk = validatePrecosNaMensagem({
  mensagem: 'Temos Flex R$199, No Limit R$149 e Clube + R$109 na musculação',
  planosReferenciados: ['musculacao_flex', 'musculacao_no_limit', 'musculacao_clube'],
  planoPrecos,
});
assert(multiOk.valid === true, '3 valores + 3 refs (todos batem) → valid');

// Matrícula referenciada junto com plano
assert(
  validatePrecosNaMensagem({
    mensagem: 'É R$199/mês mais R$99 de matrícula',
    planosReferenciados: ['musculacao_flex', 'matricula'],
    planoPrecos,
  }).valid === true,
  'R$199 + R$99 matrícula referenciada → valid'
);

// ─────────────────────────────────────────────────────────────────────
// 5. validatePrecosNaMensagem — falhas que devem disparar retry
// ─────────────────────────────────────────────────────────────────────

// Cita valor sem referenciar nada
const v1 = validatePrecosNaMensagem({
  mensagem: 'Plano custa R$199/mês',
  planosReferenciados: [],
  planoPrecos,
});
assert(v1.valid === false && v1.reason === 'referencia_vazia', 'valor sem ref → reason=referencia_vazia');
assert(v1.valoresEncontrados.includes(199), 'reporta valoresEncontrados');

// Refrência cita plano_id que não tem preço (caso raro — enum desalinhado)
const v2 = validatePrecosNaMensagem({
  mensagem: 'Plano custa R$199',
  planosReferenciados: ['plano_inexistente'],
  planoPrecos,
});
assert(v2.valid === false && v2.reason === 'plano_id_sem_preco', 'plano_id sem preço → reason=plano_id_sem_preco');

// Valor não bate com plano referenciado (cross-plan confusion)
// "Pilates Flex R$199" — mas pilates_flex é R$319, não R$199
const v3 = validatePrecosNaMensagem({
  mensagem: 'Pilates Flex é R$199',
  planosReferenciados: ['pilates_flex'],
  planoPrecos,
});
assert(v3.valid === false && v3.reason === 'valor_nao_bate', 'valor != preço referenciado → reason=valor_nao_bate');
assert(v3.mismatches.length === 1 && v3.mismatches[0].valor === 199, 'mismatch reportado');
assert(
  v3.mismatches[0].esperados[0].plano_id === 'pilates_flex' &&
  v3.mismatches[0].esperados[0].price === 319,
  'mismatch lista plano esperado'
);

// 2 valores, 1 bate, 1 não bate → reprovado pelo que não bate
const v4 = validatePrecosNaMensagem({
  mensagem: 'Flex R$199 e Clube R$300 (errado)',
  planosReferenciados: ['musculacao_flex', 'musculacao_clube'],
  planoPrecos,
});
assert(v4.valid === false, '1 dos 2 valores fora → reprova');
assert(v4.mismatches.length === 1 && v4.mismatches[0].valor === 300, 'reporta só o que não bateu');

// Plano_id sem preço: planoPrecos vazio (parser falhou) com mensagem com valor
const v5 = validatePrecosNaMensagem({
  mensagem: 'É R$199',
  planosReferenciados: ['musculacao_flex'],
  planoPrecos: {},
});
assert(v5.valid === false && v5.reason === 'plano_id_sem_preco', 'planoPrecos vazio + ref → plano_id_sem_preco');

// Mensagem sem valor + planoPrecos vazio + ref → válido (não tem o que validar)
const v6 = validatePrecosNaMensagem({
  mensagem: 'Beleza',
  planosReferenciados: ['musculacao_flex'],
  planoPrecos: {},
});
assert(v6.valid === true, 'sem valor → valid mesmo com planoPrecos vazio');

// ─── Null safety ───
assert(
  validatePrecosNaMensagem({ mensagem: null, planosReferenciados: [], planoPrecos: {} }).valid === true,
  'mensagem null safe'
);
assert(
  validatePrecosNaMensagem({ mensagem: 'oi', planosReferenciados: null, planoPrecos: {} }).valid === true,
  'planosReferenciados null safe (sem valor → valid)'
);
assert(
  validatePrecosNaMensagem({ mensagem: 'R$199', planosReferenciados: null, planoPrecos: {} }).valid === false,
  'planosReferenciados null + valor → reprovado'
);

// ─────────────────────────────────────────────────────────────────────
// 6. buildRetryHint — gera string que vai como tool_result error
// ─────────────────────────────────────────────────────────────────────

const hint1 = buildRetryHint(v1, planoPrecos);
assert(hint1.includes('VALIDAÇÃO BACKEND'), 'hint começa com header VALIDAÇÃO BACKEND');
assert(hint1.includes('R$199'), 'hint menciona o valor citado');
assert(hint1.includes('planos_referenciados=[]'), 'hint diz que array tava vazio');

const hint3 = buildRetryHint(v3, planoPrecos);
assert(hint3.includes('R$199 citado'), 'hint mismatch menciona valor citado');
assert(hint3.includes('pilates_flex=R$319'), 'hint lista plano esperado com preço');

const hint5 = buildRetryHint(v5, {});
assert(hint5.includes('plano_id_sem_preco') || hint5.includes('preço oficial conhecido'), 'hint plano_id_sem_preco');

// Hint inclui tabela completa quando planoPrecos não vazio
assert(hint1.includes('Tabela oficial'), 'hint inclui apêndice "Tabela oficial"');
assert(hint1.includes('musculacao_flex'), 'hint apêndice tem todos plano_ids');
assert(hint1.includes('matricula'), 'hint apêndice inclui matricula');

// Hint sem tabela quando planoPrecos vazio (parser falhou)
const hintSemTabela = buildRetryHint(v1, {});
assert(!hintSemTabela.includes('Tabela oficial'), 'hint sem tabela quando planoPrecos vazio');

// ─────────────────────────────────────────────────────────────────────
// 7. Constantes exportadas
// ─────────────────────────────────────────────────────────────────────

assert(TOLERANCE === 0.05, 'TOLERANCE = 5%');
assert(MIN_VALOR_VALIDADO === 50, 'MIN_VALOR_VALIDADO = R$50');

// ─────────────────────────────────────────────────────────────────────
console.log(`\n═══════════════════════════════════════════════════════════`);
console.log(`  Resultado: ${pass}/${pass + fail} passaram`);
console.log(`═══════════════════════════════════════════════════════════`);
process.exit(fail > 0 ? 1 : 0);
