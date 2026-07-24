const env = require('../utils/env');

const TELEGRAM_BASE_URL = 'https://api.telegram.org';

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

  const res = await fetch(url, { method: 'POST', body: form });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Telegram API error: ${res.status} ${errorBody}`);
  }
};

module.exports = { enviarDocumento };
