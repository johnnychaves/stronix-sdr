const OpenAI = require('openai');
require('dotenv').config({ override: true });

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Histórico de conversa por número de telefone (em memória)
const conversations = new Map();

const SYSTEM_PROMPT = `Você é um assistente de atendimento. Responda de forma simpática e direta.`;

async function reply(from, text) {
  if (!conversations.has(from)) {
    conversations.set(from, []);
  }

  const history = conversations.get(from);
  history.push({ role: 'user', content: text });

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
    ],
  });

  const answer = response.choices[0].message.content;
  history.push({ role: 'assistant', content: answer });

  console.log(`[agent] ${from} → "${text}" | resposta: "${answer.slice(0, 60)}..."`);
  return answer;
}

module.exports = { reply };
