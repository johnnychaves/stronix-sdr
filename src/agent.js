// Stub — Claude API será integrado na Etapa 2
async function reply(from, text) {
  console.log(`[agent] mensagem de ${from}: "${text}"`);
  return `Eco: ${text}`;
}

module.exports = { reply };
