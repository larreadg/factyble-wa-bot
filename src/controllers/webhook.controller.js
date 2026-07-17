const env = require('../utils/env');
const logger = require('../utils/logger');
const whatsappService = require('../services/whatsapp.service');
const botOrchestrator = require('../services/botOrchestrator.service');

const verify = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN) {
    logger.info('Webhook verified by Meta');
    return res.status(200).send(challenge);
  }

  logger.warn('Webhook verification failed', { mode, token });
  res.sendStatus(403);
};

const safeError = (error) => ({ name: error?.name, message: error?.message });

const receive = (req, res) => {
  if (env.WHATSAPP_APP_SECRET) {
    const signature = req.headers['x-hub-signature-256'];
    if (!whatsappService.verifySignature(req.rawBody, signature)) {
      logger.warn('Firma de webhook de WhatsApp inválida');
      return res.sendStatus(403);
    }
  } else {
    logger.warn('WHATSAPP_APP_SECRET no configurado: no se verifica la firma del webhook entrante');
  }

  res.sendStatus(200);

  const entries = req.body?.entry || [];

  for (const entry of entries) {
    const changes = entry.changes || [];

    for (const change of changes) {
      const value = change.value || {};

      for (const message of value.messages || []) {
        botOrchestrator.procesarMensajeEntrante(message).catch((error) => {
          logger.error('Error procesando mensaje entrante', safeError(error));
        });
      }

      for (const status of value.statuses || []) {
        botOrchestrator.procesarActualizacionEstado(status).catch((error) => {
          logger.error('Error procesando actualización de estado de mensaje', safeError(error));
        });
      }
    }
  }
};

module.exports = { verify, receive };
