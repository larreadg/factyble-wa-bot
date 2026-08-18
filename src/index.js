const express = require('express');
const env = require('./utils/env');
const logger = require('./utils/logger');
const routes = require('./routes');
const sesionBarridoService = require('./services/sesionBarrido.service');
const documentoNotificacionBarridoService = require('./services/documentoNotificacionBarrido.service');
const emisionReintentoService = require('./services/emisionReintento.service');

const app = express();

// req.rawBody se usa para verificar la firma HMAC del webhook de WhatsApp
// (ver whatsapp.service.js -> verifySignature), que debe calcularse sobre
// el cuerpo crudo de la request, antes de parsear el JSON.
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(routes);

if (!env.OPENAI_API_KEY) {
  logger.warn('OPENAI_API_KEY no está configurada: el parser conversacional de facturas fallará al usarse');
}

app.listen(env.PORT, () => {
  logger.info(`Server listening on port ${env.PORT}`);
});

// Barrido periódico de sesiones que quedaron esperando al usuario (o atascadas en
// PROCESANDO) sin llegar nunca a un estado terminal (ver sesionBarrido.service.js).
// `barriendo` evita corridas solapadas: si una vuelta tarda más que el intervalo (DB
// lenta, Telegram caído), la siguiente se salta en vez de acumularse.
let barriendo = false;
setInterval(() => {
  if (barriendo) return;
  barriendo = true;
  sesionBarridoService
    .ejecutar()
    .catch((error) => logger.error('Error inesperado en el barrido de sesiones', { name: error?.name, message: error?.message }))
    .finally(() => {
      barriendo = false;
    });
}, env.SESION_BARRIDO_INTERVALO_MS);

// Barrido que reintenta entregar el PDF de documentos emitidos cuyo envío al cliente no se
// completó (ver documentoNotificacionBarrido.service.js). Mismo patrón `notificando` para
// evitar corridas solapadas si una vuelta tarda más que el intervalo.
let notificando = false;
setInterval(() => {
  if (notificando) return;
  notificando = true;
  documentoNotificacionBarridoService
    .ejecutar()
    .catch((error) => logger.error('Error inesperado en el barrido de notificaciones', { name: error?.name, message: error?.message }))
    .finally(() => {
      notificando = false;
    });
}, env.DOCUMENTO_NOTIF_BARRIDO_INTERVALO_MS);

// Barrido que reintenta las emisiones que fallaron por una caída transitoria del servicio
// (ver emisionReintento.service.js). Mismo patrón `reintentandoEmision` para no solapar vueltas.
let reintentandoEmision = false;
setInterval(() => {
  if (reintentandoEmision) return;
  reintentandoEmision = true;
  emisionReintentoService
    .ejecutar()
    .catch((error) => logger.error('Error inesperado en el barrido de reintentos de emisión', { name: error?.name, message: error?.message }))
    .finally(() => {
      reintentandoEmision = false;
    });
}, env.EMISION_REINTENTO_BARRIDO_INTERVALO_MS);
