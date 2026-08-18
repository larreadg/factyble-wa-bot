const env = require('../utils/env');

const TELEGRAM_BASE_URL = 'https://api.telegram.org';

// Timeout para las llamadas a la API de Telegram: sin esto, un request colgado deja esperando
// indefinidamente a quien lo await-ee. Importa sobre todo para enviarMensaje, que se awaitea
// dentro del barrido de reintentos de emisión (un cuelgue ahí congelaría todo el barrido).
const fetchConTimeout = async (url, options = {}) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), env.TELEGRAM_API_TIMEOUT_MS);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Telegram API timeout tras ${env.TELEGRAM_API_TIMEOUT_MS}ms (${url})`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
};

// Usada por chatExport.service.js, que ya atrapa cualquier error acá adentro: esta
// función puede rechazar libremente, no necesita manejar el caso de configuración
// faltante en silencio (eso sí lo decide el caller).
const enviarDocumento = async ({ nombreArchivo, contenidoTexto, caption }) => {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    throw new Error('TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID no configurados');
  }

  const url = `${TELEGRAM_BASE_URL}/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`;

  const form = new FormData();
  form.append('chat_id', env.TELEGRAM_CHAT_ID);
  if (caption) form.append('caption', caption);
  form.append('document', new Blob([contenidoTexto], { type: 'text/plain' }), nombreArchivo);

  const res = await fetchConTimeout(url, { method: 'POST', body: form });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Telegram API error: ${res.status} ${errorBody}`);
  }
};

// Alerta de texto al mismo chat de Telegram (ej. cuando se agotan los reintentos de emisión
// de una factura, ver botOrchestrator.service.js). Igual que enviarDocumento, puede rechazar:
// el caller decide si atrapar el error de configuración/envío.
const enviarMensaje = async (texto) => {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    throw new Error('TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID no configurados');
  }

  const url = `${TELEGRAM_BASE_URL}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;

  const res = await fetchConTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: texto }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Telegram API error: ${res.status} ${errorBody}`);
  }
};

module.exports = { enviarDocumento, enviarMensaje };
