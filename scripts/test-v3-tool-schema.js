#!/usr/bin/env node
// Testes unitários do PR1 da migração v3 — schema da tool `responder_ao_lead`,
// extração do tool_use block, conversão pro formato `parsed` (compat com v2),
// e sanitização da mensagem. Roda offline (sem API), sub-100ms.

const {
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
} = require('../src/v3-tools');

let pass = 0, fail = 0;
function assert(cond, name, detail) {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}${detail ? '\n  ' + detail : ''}`); }
}

// ─────────────────────────────────────────────────────────────────────
// 1. ENUMS — cobertura espelhando lead_state v2 + 28 módulos
// ─────────────────────────────────────────────────────────────────────

assert(ESTAGIOS.length === 10, 'ESTAGIOS tem 10 estágios da máquina v2', `got ${ESTAGIOS.length}`);
assert(ESTAGIOS.includes('handoff_humano'), 'ESTAGIOS inclui handoff_humano');
assert(ESTAGIOS.includes('apresentacao_planos'), 'ESTAGIOS inclui apresentacao_planos');
assert(ESTAGIOS.includes('qualificacao_inicial'), 'ESTAGIOS inclui qualificacao_inicial');

assert(OBJETIVOS.includes(''), 'OBJETIVOS inclui string vazia (não declarado)');
assert(OBJETIVOS.length === 5, 'OBJETIVOS tem 5 valores incluindo vazio');

assert(MODALIDADES.includes('musculacao'), 'MODALIDADES inclui musculacao');
assert(MODALIDADES.includes('pilates'), 'MODALIDADES inclui pilates');
assert(MODALIDADES.includes('personalizado'), 'MODALIDADES inclui personalizado');

assert(DISPONIBILIDADES.includes('manha') && DISPONIBILIDADES.includes('tarde'), 'DISPONIBILIDADES tem manha e tarde');

assert(OBJECOES.length === 10, 'OBJECOES tem 10 (9 objeções + vazio)', `got ${OBJECOES.length}`);
assert(OBJECOES.includes('preco') && OBJECOES.includes('convenio'), 'OBJECOES tem preco e convenio');

assert(MODULOS.length === 28, 'MODULOS tem exatamente 28 (espelha prompt-modules-seed)', `got ${MODULOS.length}`);
assert(MODULOS.includes('planos_e_precos'), 'MODULOS inclui planos_e_precos');
assert(MODULOS.includes('objecoes_geral'), 'MODULOS inclui objecoes_geral');
assert(MODULOS.includes('cenarios_borda'), 'MODULOS inclui cenarios_borda');
assert(new Set(MODULOS).size === 28, 'MODULOS sem duplicatas');

// ─────────────────────────────────────────────────────────────────────
// 2. TOOL DEFINITION — shape esperado pelo Anthropic API
// ─────────────────────────────────────────────────────────────────────

const tool = buildToolDefinition();

assert(tool.name === 'responder_ao_lead', 'tool.name é responder_ao_lead');
assert(typeof tool.description === 'string' && tool.description.length > 50, 'tool.description é string substantiva');
assert(tool.input_schema && tool.input_schema.type === 'object', 'input_schema.type === object');
assert(Array.isArray(tool.input_schema.required), 'input_schema.required é array');
assert(tool.input_schema.required.includes('estado_atual'), 'estado_atual obrigatório');
assert(tool.input_schema.required.includes('mensagem_ao_lead'), 'mensagem_ao_lead obrigatório');

const props = tool.input_schema.properties;
assert(props.estado_atual && props.estado_atual.type === 'object', 'estado_atual é object');
assert(props.estado_atual.required.includes('estagio'), 'estado_atual.estagio obrigatório');
assert(props.estado_atual.required.includes('proxima_acao'), 'estado_atual.proxima_acao obrigatório');

assert(
  Array.isArray(props.estado_atual.properties.estagio.enum) && props.estado_atual.properties.estagio.enum.length === 10,
  'estagio enum tem 10 valores'
);
assert(props.estado_atual.properties.insistencias_valor.minimum === 0, 'insistencias_valor min=0');
assert(props.estado_atual.properties.insistencias_valor.maximum === 3, 'insistencias_valor max=3');

assert(props.mensagem_ao_lead.maxLength === 2000, 'mensagem_ao_lead maxLength=2000');
assert(props.mensagem_ao_lead.minLength === 1, 'mensagem_ao_lead minLength=1');

assert(typeof props.responder_em_audio === 'object' && props.responder_em_audio.type === 'boolean', 'responder_em_audio é boolean');
assert(typeof props.pedir_audio_ao_lead === 'object' && props.pedir_audio_ao_lead.type === 'boolean', 'pedir_audio_ao_lead é boolean');

assert(
  Array.isArray(props.modulo_proximo_turno.enum) && props.modulo_proximo_turno.enum.includes(''),
  'modulo_proximo_turno enum aceita vazio (sem módulo)'
);
assert(
  props.modulo_proximo_turno.enum.length === 29,
  '28 módulos + vazio = 29 entries no enum'
);

assert(typeof ADDENDUM_V3 === 'string' && ADDENDUM_V3.includes('responder_ao_lead'), 'ADDENDUM_V3 menciona o nome da tool');
assert(ADDENDUM_V3.includes('NÃO escreva'), 'ADDENDUM_V3 instrui a não emitir tags');

// ─────────────────────────────────────────────────────────────────────
// 3. EXTRACT TOOL INPUT — caminho feliz + edge cases
// ─────────────────────────────────────────────────────────────────────

const happyResponse = {
  content: [
    { type: 'tool_use', name: TOOL_NAME, input: { estado_atual: { estagio: 'qualificacao_inicial', proxima_acao: 'cumprimentar' }, mensagem_ao_lead: 'Oi!' } },
  ],
};
const happyInput = extractToolInput(happyResponse);
assert(happyInput && happyInput.mensagem_ao_lead === 'Oi!', 'extractToolInput pega mensagem_ao_lead');

assert(extractToolInput(null) === null, 'extractToolInput null safe');
assert(extractToolInput({}) === null, 'extractToolInput sem content é null');
assert(extractToolInput({ content: 'string' }) === null, 'extractToolInput content não-array é null');
assert(extractToolInput({ content: [] }) === null, 'extractToolInput content vazio é null');
assert(
  extractToolInput({ content: [{ type: 'text', text: 'oi' }] }) === null,
  'extractToolInput sem tool_use block é null'
);
assert(
  extractToolInput({ content: [{ type: 'tool_use', name: 'outra_tool', input: {} }] }) === null,
  'extractToolInput nome de tool errado é null'
);
assert(
  extractToolInput({ content: [{ type: 'tool_use', name: TOOL_NAME, input: null }] }) === null,
  'extractToolInput input null é null'
);

// Resposta com text block antes do tool_use (modelo às vezes faz)
const mistura = {
  content: [
    { type: 'text', text: 'pensando...' },
    { type: 'tool_use', name: TOOL_NAME, input: { estado_atual: {}, mensagem_ao_lead: 'oi' } },
  ],
};
assert(extractToolInput(mistura).mensagem_ao_lead === 'oi', 'extractToolInput pega tool_use mesmo com text block antes');

// ─── findAllToolUseBlocks — canário pra detectar mudança de contrato Anthropic ───
assert(findAllToolUseBlocks(null).length === 0, 'findAllToolUseBlocks null safe (response null)');
assert(findAllToolUseBlocks({}).length === 0, 'findAllToolUseBlocks sem content é []');
assert(findAllToolUseBlocks({ content: 'string' }).length === 0, 'findAllToolUseBlocks content não-array é []');
assert(findAllToolUseBlocks({ content: [] }).length === 0, 'findAllToolUseBlocks content vazio é []');
assert(
  findAllToolUseBlocks({ content: [{ type: 'text', text: 'oi' }] }).length === 0,
  'findAllToolUseBlocks ignora text blocks'
);
assert(findAllToolUseBlocks(happyResponse).length === 1, 'findAllToolUseBlocks retorna 1 no caminho feliz');
assert(
  findAllToolUseBlocks({ content: [{ type: 'tool_use', name: 'outra_tool', input: {} }] }).length === 0,
  'findAllToolUseBlocks ignora tool com nome diferente'
);

// Cenário canário: API hipoteticamente retorna 2 tool_use (não deveria com disable_parallel_tool_use=true)
const dois = {
  content: [
    { type: 'tool_use', name: TOOL_NAME, input: { estado_atual: {}, mensagem_ao_lead: 'primeiro' } },
    { type: 'tool_use', name: TOOL_NAME, input: { estado_atual: {}, mensagem_ao_lead: 'segundo' } },
  ],
};
assert(findAllToolUseBlocks(dois).length === 2, 'findAllToolUseBlocks pega os 2 quando API anômala retorna 2');
assert(
  extractToolInput(dois).mensagem_ao_lead === 'primeiro',
  'extractToolInput pega o PRIMEIRO quando API retorna múltiplos (canário acionado em separado)'
);

// Misto: 1 tool_use nosso + 1 tool_use com nome diferente (não deveria, mas defensivo)
const misto = {
  content: [
    { type: 'tool_use', name: 'outra', input: {} },
    { type: 'tool_use', name: TOOL_NAME, input: { estado_atual: {}, mensagem_ao_lead: 'meu' } },
  ],
};
assert(findAllToolUseBlocks(misto).length === 1, 'findAllToolUseBlocks só conta blocos do TOOL_NAME');

// ─────────────────────────────────────────────────────────────────────
// 4. TOOL INPUT → PARSED — conversão pro formato compat com agent-v2
// ─────────────────────────────────────────────────────────────────────

const fullInput = {
  estado_atual: {
    estagio: 'apresentacao_planos',
    proxima_acao: 'mostrar tabela de planos',
    insistencias_valor: 3,
    objetivo: 'emagrecer',
    nome: 'Maria',
    modalidade: 'musculacao',
    disponibilidade: 'manha',
    objecao_ativa: 'preco',
  },
  mensagem_ao_lead: 'Olha Maria, temos 3 planos: Flex R$199, No Limit R$149 e Clube + R$109. Qual faz mais sentido?',
  responder_em_audio: false,
  pedir_audio_ao_lead: false,
  modulo_proximo_turno: 'objecao_preco',
  agendamento: { nome: '', dia: '', hora: '', modalidade: '' },
};
const fullParsed = toolInputToParsed(fullInput);

assert(fullParsed.stateFields.estagio_atual === 'apresentacao_planos', 'mapeia estagio → estagio_atual');
assert(fullParsed.stateFields.proxima_acao === 'mostrar tabela de planos', 'mapeia proxima_acao');
assert(fullParsed.stateFields.insistencias_valor === 3, 'mapeia insistencias_valor');
assert(fullParsed.stateFields.objetivo === 'emagrecer', 'mapeia objetivo');
assert(fullParsed.stateFields.modalidade_recomendada === 'musculacao', 'modalidade → modalidade_recomendada');
assert(fullParsed.stateFields.disponibilidade === 'manha', 'mapeia disponibilidade');
assert(fullParsed.stateFields.objecao_ativa === 'preco', 'mapeia objecao_ativa');
assert(fullParsed.nameFromTag === 'Maria', 'nome separado pra contacts.name');
assert(fullParsed.requiredModule === 'objecao_preco', 'modulo_proximo_turno → requiredModule');
assert(fullParsed.agendamento === null, 'agendamento com todos campos vazios → null');
assert(fullParsed.useAudio === false, 'useAudio false');
assert(fullParsed.askingForAudio === false, 'askingForAudio false');

// Insistencias_valor clamp
const overInsist = toolInputToParsed({ estado_atual: { insistencias_valor: 99, estagio: 'qualificacao_inicial' }, mensagem_ao_lead: 'x' });
assert(overInsist.stateFields.insistencias_valor === 3, 'insistencias_valor clamp em 3 (max)');

const negInsist = toolInputToParsed({ estado_atual: { insistencias_valor: -5 }, mensagem_ao_lead: 'x' });
assert(negInsist.stateFields.insistencias_valor === 0, 'insistencias_valor clamp em 0 (min)');

const floatInsist = toolInputToParsed({ estado_atual: { insistencias_valor: 2.7 }, mensagem_ao_lead: 'x' });
assert(floatInsist.stateFields.insistencias_valor === 2, 'insistencias_valor float é truncado');

// stateFields null quando estado_atual vazio
const emptyState = toolInputToParsed({ estado_atual: {}, mensagem_ao_lead: 'x' });
assert(emptyState.stateFields === null, 'estado_atual sem campos → stateFields null (compat com detectsTagEsquecida)');

// Agendamento parcialmente preenchido
const agParcial = toolInputToParsed({
  estado_atual: { estagio: 'agendamento_confirmado' },
  mensagem_ao_lead: 'beleza',
  agendamento: { nome: 'Maria', dia: 'terça', hora: '9h', modalidade: 'musculacao' },
});
assert(
  agParcial.agendamento && agParcial.agendamento.nome === 'Maria' && agParcial.agendamento.hora === '9h',
  'agendamento preenchido vira objeto'
);

// modulo_proximo_turno vazio = sem módulo
const semMod = toolInputToParsed({ estado_atual: { estagio: 'qualificacao_inicial' }, mensagem_ao_lead: 'x', modulo_proximo_turno: '' });
assert(semMod.requiredModule === null, 'modulo_proximo_turno vazio → null');

const moduloNenhum = toolInputToParsed({ estado_atual: { estagio: 'qualificacao_inicial' }, mensagem_ao_lead: 'x', modulo_proximo_turno: 'nenhum' });
assert(moduloNenhum.requiredModule === null, 'modulo_proximo_turno="nenhum" → null (compat com tag v2)');

// useAudio + askingForAudio
const audioOn = toolInputToParsed({ estado_atual: { estagio: 'qualificacao_inicial' }, mensagem_ao_lead: 'x', responder_em_audio: true });
assert(audioOn.useAudio === true, 'responder_em_audio: true → useAudio: true');

const askAudio = toolInputToParsed({ estado_atual: { estagio: 'qualificacao_inicial' }, mensagem_ao_lead: 'x', pedir_audio_ao_lead: true });
assert(askAudio.askingForAudio === true, 'pedir_audio_ao_lead: true → askingForAudio: true');

// Null safety
const nullParsed = toolInputToParsed(null);
assert(nullParsed.stateFields === null && nullParsed.cleanText === '', 'toolInputToParsed null safe');

const emptyParsed = toolInputToParsed({});
assert(emptyParsed.stateFields === null && emptyParsed.cleanText === '', 'toolInputToParsed sem campos null safe');

// nome vazio NÃO captura (capturar só se tem conteúdo)
const semNome = toolInputToParsed({ estado_atual: { estagio: 'qualificacao_inicial', nome: '' }, mensagem_ao_lead: 'x' });
assert(semNome.nameFromTag === null, 'nome vazio não vira nameFromTag');

// ─────────────────────────────────────────────────────────────────────
// 5. SANITIZE MENSAGEM — defesa contra hábito do prompt v2
// ─────────────────────────────────────────────────────────────────────

assert(sanitizeMensagem('Oi tudo bem?') === 'Oi tudo bem?', 'mensagem limpa passa intacta');
assert(sanitizeMensagem('Beleza — vou te passar') === 'Beleza, vou te passar', 'em-dash vira vírgula+espaço');
assert(sanitizeMensagem('opa – e aí') === 'opa, e aí', 'en-dash também vira vírgula');
assert(sanitizeMensagem('[ESTADO:estagio=x|nome=y] Oi') === 'Oi', '[ESTADO:...] removido do início');
assert(sanitizeMensagem('Oi [MODULO_REQUERIDO:planos_e_precos]') === 'Oi', '[MODULO_REQUERIDO:...] removido');
assert(sanitizeMensagem('[AUDIO] Beleza') === 'Beleza', '[AUDIO] removido');
assert(sanitizeMensagem('[PEDIR_AUDIO] posso te falar') === 'posso te falar', '[PEDIR_AUDIO] removido');
assert(sanitizeMensagem('') === '', 'string vazia null safe');
assert(sanitizeMensagem(null) === '', 'null safe');
assert(sanitizeMensagem(undefined) === '', 'undefined safe');
assert(sanitizeMensagem(123) === '', 'tipo errado safe');

// Combinação: tags + em-dash
const sujo = '[ESTADO:estagio=x] Beleza — temos planos a partir de R$ 109';
assert(sanitizeMensagem(sujo) === 'Beleza, temos planos a partir de R$ 109', 'tag + em-dash removidos juntos');

// ─────────────────────────────────────────────────────────────────────
// 6. CONTRATO COM AGENT-V2 — keys do `parsed` precisam bater
// ─────────────────────────────────────────────────────────────────────

const v2CompatKeys = ['stateFields', 'nameFromTag', 'requiredModule', 'agendamento', 'cleanText'];
const sample = toolInputToParsed({ estado_atual: { estagio: 'qualificacao_inicial' }, mensagem_ao_lead: 'oi' });
for (const k of v2CompatKeys) {
  assert(k in sample, `parsed.${k} existe (compat com computeStateUpdate do v2)`);
}
assert('useAudio' in sample, 'parsed.useAudio existe (extra v3, derivado do bool)');
assert('askingForAudio' in sample, 'parsed.askingForAudio existe (extra v3)');

// ─────────────────────────────────────────────────────────────────────
console.log(`\n═══════════════════════════════════════════════════════════`);
console.log(`  Resultado: ${pass}/${pass + fail} passaram`);
console.log(`═══════════════════════════════════════════════════════════`);
process.exit(fail > 0 ? 1 : 0);
