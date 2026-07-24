const express = require('express');
const env = require('./utils/env');
const logger = require('./utils/logger');
const routes = require('./routes');
const sesionBarridoService = require('./services/sesionBarrido.service');

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
