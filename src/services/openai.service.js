const OpenAI = require('openai');
const env = require('../utils/env');

let client = null;

// Instancia única y reutilizable del cliente OpenAI. Se crea de forma perezosa para
// no romper el arranque del servidor si la funcionalidad de IA aún no está configurada;
// el error se produce recién al intentar usarla (capturado y mapeado por quien la invoque).
const getClient = () => {
  if (!client) {
    if (!env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY no está configurada');
    }
    client = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: env.OPENAI_TIMEOUT_MS, maxRetries: 0 });
  }
  return client;
};

module.exports = { getClient };
