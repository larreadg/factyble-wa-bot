const logger = require('../src/utils/logger');
const whatsappService = require('../src/services/whatsapp.service');

const DEFAULT_WEBHOOK_URL = 'https://factyble.simplifika.lat/api-bot/webhook';

const main = async () => {
  const webhookUrl = process.argv[2] || DEFAULT_WEBHOOK_URL;

  logger.info(`Registrando webhook en Meta: ${webhookUrl}`);

  const data = await whatsappService.updateWebhookUrl(webhookUrl);

  logger.info('Webhook de WhatsApp actualizado correctamente.', data);
};

main().catch((err) => {
  logger.error('updateWebhookUrl falló:', err.message);
  process.exit(1);
});
