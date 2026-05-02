// ═══════════════════════════════════════════════════════════════
// ROUTER V2 — decide DINAMICAMENTE quais módulos carregar
// ═══════════════════════════════════════════════════════════════
//
// Fase 2 do plano de refatoração v2 (PR #34). Substitui o fallback
// "só carrega modulo_pendente" do PR #32. Determinístico (regras
// heurísticas) — escolha sócio: cobre 80% dos casos com 20% do
// esforço. Se aparecer caso edge não-coberto em produção, evolui
// pra híbrido com Haiku 4.5.
//
// Inputs: { state, text, modulo_pendente }
// Output: array com até MAX_MODULES nomes de módulos.

// Mapa: objecao_ativa do lead_state → módulo correspondente.
// Domínio do estagio segue VALID_OBJECAO em db.js.
const OBJECAO_TO_MODULE = {
  preco: 'objecao_preco',
  tempo: 'objecao_tempo',
  pensar: 'objecao_pensar',
  adiar: 'objecao_adiar',
  mensal: 'objecao_mensal',
  pagamento: 'objecao_pagamento',
  conjuge: 'objecao_conjuge',
  distancia: 'objecao_distancia',
  convenio: 'objecao_convenio',
};

// Keyword rules em ordem de prioridade (primeiras vencem o limit de slots).
// Regras tendem ao falso-negativo (lead pode mencionar sem precisar do módulo)
// — preferimos NÃO carregar a carregar errado e poluir o prompt.
const KEYWORD_RULES = [
  // Públicos especiais — alta prioridade (lead que se identifica precisa de cuidado específico)
  { module: 'publicos_especificos', re: /\b(gr[áa]vid[ao]|gestante|lactante|p[óo]s[\s-]?parto|amamentando)\b/i },
  { module: 'publicos_especificos', re: /\b(idoso|idosa|aposentad[oa]|terceira idade)\b/i },
  { module: 'publicos_especificos', re: /\b(6[5-9]|7[0-9]|8[0-9]|9[0-9])\s*anos?\b/i },
  { module: 'publicos_especificos', re: /\b(adolescente|menor de idade|crian[çc]a)\b/i },
  { module: 'publicos_especificos', re: /\b(obeso|obesa|sobrepeso|muito acima do peso)\b/i },
  // Saúde / lesão → equipe técnica (handoff frequente)
  { module: 'equipe_tecnica', re: /\b(les[ãa]o|cirurgia|h[ée]rnia|tendinite|fisioterapia|reabilita[çc][ãa]o)\b/i },
  { module: 'equipe_tecnica', re: /\b(joelho|coluna|ombro|lombar|cervical)\s+(d[óo]i|machucad[oa]|operad[oa]|problemas?)/i },
  // Objeções específicas via keyword (caso o LLM ainda não tenha marcado objecao_ativa)
  { module: 'objecao_convenio', re: /\b(gympass|wellhub|conv[êe]nio|totalpass)\b/i },
  { module: 'objecao_distancia', re: /\b(longe|muito distante|n[ãa]o tem como ir|sem condi[çc][ãa]o de chegar)\b/i },
  { module: 'objecao_conjuge', re: /\b(esposa|marido|namorad[oa]|c[ôo]njuge|companheir[oa])\s+(precisa|tem que|vai|quer|gostari[ai]|falar)/i },
  { module: 'objecao_mensal', re: /\b(plano\s+mensal|s[óo]\s+mensal|n[ãa]o quero fidelidade|n[ãa]o gosto de fidelidade)\b/i },
  // Info da academia (operacional)
  { module: 'info_academia', re: /\b(estacionamento|vesti[áa]rio|chuveiro|arm[áa]rio|endere[çc]o|onde fica|como chegar)\b/i },
  { module: 'info_academia', re: /\b(hor[áa]rio|que horas|abre|fecha)\b/i },
  // Modalidades
  { module: 'modalidades', re: /\b(musc?ula[çc][ãa]o|pilates|funcional|crossfit|dan[çc]a|zumba|spinning|aer[óo]bica|yoga|jiu-?jitsu|muay|boxe|natur?a[çc][ãa]o|hidro)\b/i },
  // Política de plano
  { module: 'cancelamento_congelamento', re: /\b(cancelar|cancela(?:mento|[çc][ãa]o)|congelar|congelamento|trancar|fidelidade|car[êe]ncia|multa por sair)\b/i },
  { module: 'pagamento', re: /\b(pix|cart[ãa]o|cr[ée]dito|d[ée]bito|boleto|parcel(ar|amento)|forma\s+de\s+pagamento)\b/i },
  { module: 'indicacao', re: /\b(indica(r|[çc][ãa]o)|free\s*pass|trazer\s+amig[oa])\b/i },
  { module: 'transferencia_clube', re: /\b(transferir plano|transfer[êe]ncia|passar pra outr[oa])\b/i },
  // Provas sociais (lead duvidando ou validando)
  { module: 'provas_sociais', re: /\b(funciona mesmo|d[áa]\s+resultado|caso de sucesso|hist[óo]ria de quem)\b/i },
  // Concorrência (lead comparando)
  { module: 'concorrencia', re: /\b(outra academia|academia do lami|smart fit|bio sa[úu]de|comparar com)\b/i },
];

// Limit defensivo: muitos módulos = prompt bloat = cache miss + custo + latência.
// 3 cobre praticamente todos os casos compostos (modulo_pendente + estado + 1 keyword).
const MAX_MODULES = 3;

// Lista de estágios que sempre precisam de módulo específico
const ESTAGIO_TO_MODULE = {
  apresentacao_planos: 'planos_e_precos',
  proposta_visita: 'fluxo_aula_experimental',
  drill_horario: 'fluxo_aula_experimental',
};

// ═══════════════════════════════════════════════════════════════
// API PÚBLICA
// ═══════════════════════════════════════════════════════════════

// Decide quais módulos carregar pra um turno.
// Prioridade (ordem de inserção determina qual fica se passar do limit):
// 1. modulo_pendente (tag manual do Johnny no turno anterior)
// 2. Estado-based (estagio_atual, objecao_ativa)
// 3. Keyword-based (regex no texto do lead)
function routeModules({ state, text, modulo_pendente } = {}) {
  const modules = new Set();

  // 1. Tag manual do turno anterior — controle explícito do LLM principal
  if (modulo_pendente) modules.add(modulo_pendente);

  // 2a. Estágio sempre carrega módulo dedicado (planos_e_precos, fluxo_aula_experimental)
  if (state?.estagio_atual && ESTAGIO_TO_MODULE[state.estagio_atual]) {
    modules.add(ESTAGIO_TO_MODULE[state.estagio_atual]);
  }

  // 2b. objecao_ativa marcada → carrega objeção específica + manual geral
  if (state?.objecao_ativa && OBJECAO_TO_MODULE[state.objecao_ativa]) {
    modules.add(OBJECAO_TO_MODULE[state.objecao_ativa]);
    modules.add('objecoes_geral');
  }

  // 3. Keyword-based no texto do lead atual
  if (text) {
    for (const rule of KEYWORD_RULES) {
      if (rule.re.test(text)) modules.add(rule.module);
      if (modules.size >= MAX_MODULES) break;
    }
  }

  return Array.from(modules).slice(0, MAX_MODULES);
}

module.exports = {
  routeModules,
  // exportados pra testes
  OBJECAO_TO_MODULE,
  ESTAGIO_TO_MODULE,
  KEYWORD_RULES,
  MAX_MODULES,
};
