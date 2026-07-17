const express = require('express');
const env = require('./utils/env');
const logger = require('./utils/logger');
const routes = require('./routes');

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
