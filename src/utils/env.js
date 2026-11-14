require('dotenv').config();

const enteroNoNegativo = (valor, porDefecto) => {
  if (valor == null || String(valor).trim() === '') return porDefecto;
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= 0 ? numero : porDefecto;
};

module.exports = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL,
  API_KEY: process.env.API_KEY,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,

  WHATSAPP_API_VERSION: process.env.WHATSAPP_API_VERSION,
  WHATSAPP_APP_ID: process.env.WHATSAPP_APP_ID,
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_BUSINESS_ACCOUNT_ID: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN,
  WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET,
  // Timeout de cada llamada a la Graph API de WhatsApp. Sin esto, un fetch colgado (ej. la
  // subida del PDF) deja la emisión sin resolverse indefinidamente (ver whatsapp.service.js).
  WHATSAPP_API_TIMEOUT_MS: Number(process.env.WHATSAPP_API_TIMEOUT_MS) || 30000,

  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
  OPENAI_TRANSCRIPTION_MODEL: process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe',
  OPENAI_REASONING_EFFORT: process.env.OPENAI_REASONING_EFFORT || 'none',
  OPENAI_PROMPT_CACHE_KEY: process.env.OPENAI_PROMPT_CACHE_KEY || 'factyble:invoice-parser:v1',
  OPENAI_MAX_OUTPUT_TOKENS: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS) || 1000,
  OPENAI_TIMEOUT_MS: Number(process.env.OPENAI_TIMEOUT_MS) || 15000,
  // Lectura de fotos de facturas físicas (facturaImagenParser.service.js). Por defecto el mismo
  // modelo que el parser de texto; timeout y tope de salida más altos porque una imagen en
  // detalle alto con hasta 20 ítems tarda y produce bastante más que un mensaje de texto.
  OPENAI_VISION_MODEL: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || 'gpt-5.4-mini',
  OPENAI_VISION_TIMEOUT_MS: Number(process.env.OPENAI_VISION_TIMEOUT_MS) || 45000,
  OPENAI_VISION_MAX_OUTPUT_TOKENS: Number(process.env.OPENAI_VISION_MAX_OUTPUT_TOKENS) || 2500,
  // Fotos que llegan con menos de esta diferencia entre sí se consideran mandadas juntas (un
  // álbum): no se procesa ninguna y se pide una sola. Cada foto espera este tiempo antes de
  // leerse, para dar lugar a que lleguen las demás. A diferencia del resto, 0 es un valor válido
  // (desactiva la espera; lo usan los tests), así que no alcanza con `|| default`: un valor vacío o
  // no numérico cae al default en vez de quedar en 0 (control apagado) o NaN (fechas inválidas).
  IMAGEN_RAFAGA_VENTANA_MS: enteroNoNegativo(process.env.IMAGEN_RAFAGA_VENTANA_MS, 4000),

  // API de facturación (POST /usuario/authenticate, POST /factura/simple, GET /public/*).
  FACTURACION_API_BASE_URL: process.env.FACTURACION_API_BASE_URL,
  // Generoso por defecto: el backend de facturación espera a que JasperReports termine
  // de generar el PDF antes de responder /factura/simple.
  FACTURACION_API_TIMEOUT_MS: Number(process.env.FACTURACION_API_TIMEOUT_MS) || 30000,
  // Reintento de fondo de la emisión ante fallas transitorias del servicio (503/timeout/red,
  // etc.): cada EMISION_REINTENTO_INTERVALO_MS, hasta EMISION_REINTENTO_MAX veces; al
  // agotarse se alerta por Telegram (ver emisionReintento.service.js y botOrchestrator.service.js).
  // Es seguro contra duplicados: cada reintento reconcilia por idExterno antes de reemitir.
  // BARRIDO_INTERVALO_MS = cada cuánto el barrido revisa si hay reintentos vencidos.
  EMISION_REINTENTO_INTERVALO_MS: Number(process.env.EMISION_REINTENTO_INTERVALO_MS) || 15 * 60 * 1000,
  EMISION_REINTENTO_MAX: Number(process.env.EMISION_REINTENTO_MAX) || 3,
  EMISION_REINTENTO_BARRIDO_INTERVALO_MS: Number(process.env.EMISION_REINTENTO_BARRIDO_INTERVALO_MS) || 60 * 1000,

  // Bot de Telegram al que se envía el detalle .txt de cada chat al finalizar/cancelarse
  // (ver chatExport.service.js) y las alertas de emisión fallida (ver botOrchestrator.service.js).
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  TELEGRAM_API_TIMEOUT_MS: Number(process.env.TELEGRAM_API_TIMEOUT_MS) || 15000,

  // Barrido de sesiones que quedaron esperando algo del usuario y nunca llegaron a un
  // estado terminal (ver sesionBarrido.service.js). 24h por defecto: coincide con la
  // ventana de mensajería de WhatsApp (fuera de ella tampoco se le puede escribir de
  // vuelta con un mensaje de texto libre). PROCESANDO expira mucho antes: normalmente se
  // resuelve en el mismo request-response, así que tardar más ahí indica una caída del
  // proceso a mitad de una emisión/cancelación, no inactividad del usuario.
  SESION_INACTIVA_TIMEOUT_MS: Number(process.env.SESION_INACTIVA_TIMEOUT_MS) || 24 * 60 * 60 * 1000,
  SESION_PROCESANDO_TIMEOUT_MS: Number(process.env.SESION_PROCESANDO_TIMEOUT_MS) || 15 * 60 * 1000,
  SESION_BARRIDO_INTERVALO_MS: Number(process.env.SESION_BARRIDO_INTERVALO_MS) || 10 * 60 * 1000,

  // Barrido que reintenta entregar el PDF de documentos emitidos cuyo envío al cliente no se
  // completó (ver documentoNotificacionBarrido.service.js). INTERVALO: cada cuánto corre.
  // VENTANA: hasta qué antigüedad se reintenta (24h por defecto, coincide con la ventana de
  // mensajería de WhatsApp: fuera de ella ya no se puede mandar un mensaje libre al usuario).
  DOCUMENTO_NOTIF_BARRIDO_INTERVALO_MS: Number(process.env.DOCUMENTO_NOTIF_BARRIDO_INTERVALO_MS) || 2 * 60 * 1000,
  DOCUMENTO_NOTIF_VENTANA_MS: Number(process.env.DOCUMENTO_NOTIF_VENTANA_MS) || 24 * 60 * 60 * 1000,
};
