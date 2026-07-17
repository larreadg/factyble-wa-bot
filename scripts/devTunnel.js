const fs = require('fs');
const { bin, install, Tunnel } = require('cloudflared');
const env = require('../src/utils/env');
const logger = require('../src/utils/logger');

const TUNNEL_SETTLE_MS = 5000;
const WEBHOOK_UPDATE_RETRIES = 4;
const WEBHOOK_UPDATE_RETRY_DELAY_MS = 4000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const updateWhatsappWebhook = async (webhookUrl) => {
  const endpoint = `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_BUSINESS_ACCOUNT_ID}/subscribed_apps`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      override_callback_uri: webhookUrl,
      verify_token: env.WHATSAPP_VERIFY_TOKEN,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Meta API respondió ${response.status}: ${JSON.stringify(data)}`);
  }

  return data;
};

// Un túnel "quick" de trycloudflare.com puede tardar unos segundos en propagarse
// globalmente después de emitir la URL; si Meta intenta verificar el callback
// demasiado pronto, falla con "Failed to resolve host". Por eso esperamos un
// momento y reintentamos.
const updateWhatsappWebhookWithRetry = async (webhookUrl) => {
  await sleep(TUNNEL_SETTLE_MS);

  for (let attempt = 1; attempt <= WEBHOOK_UPDATE_RETRIES; attempt += 1) {
    try {
      await updateWhatsappWebhook(webhookUrl);
      return;
    } catch (err) {
      if (attempt === WEBHOOK_UPDATE_RETRIES) throw err;
      logger.warn(
        `Intento ${attempt}/${WEBHOOK_UPDATE_RETRIES} de registrar el webhook falló, reintentando...`,
        err.message,
      );
      await sleep(WEBHOOK_UPDATE_RETRY_DELAY_MS);
    }
  }
};

const main = async () => {
  if (!fs.existsSync(bin)) {
    logger.info('Descargando binario de cloudflared...');
    await install(bin);
  }

  const localUrl = `http://localhost:${env.PORT}`;
  logger.info(`Levantando túnel de Cloudflare hacia ${localUrl}...`);

  const tunnel = Tunnel.quick(localUrl);

  // cloudflared reemite el evento 'url' varias veces (una por cada conexión
  // edge que establece) aunque la URL no cambie. Sin esta guarda, cada
  // repetición dispara su propio ciclo de reintentos en paralelo justo
  // cuando el túnel todavía se está asentando, saturándolo con registros
  // concurrentes y provocando 502 en cascada.
  let latestUrl = null;

  tunnel.on('url', async (tunnelUrl) => {
    logger.info(`Túnel activo: ${tunnelUrl}`);

    if (tunnelUrl === latestUrl) return;
    latestUrl = tunnelUrl;

    const webhookUrl = `${tunnelUrl}/webhook`;
    logger.info(`Registrando webhook en Meta: ${webhookUrl}`);

    try {
      await updateWhatsappWebhookWithRetry(webhookUrl);
      if (tunnelUrl === latestUrl) {
        logger.info('Webhook de WhatsApp actualizado correctamente.');
      }
    } catch (err) {
      if (tunnelUrl === latestUrl) {
        logger.error('No se pudo actualizar el webhook de WhatsApp:', err.message);
      }
    }
  });

  tunnel.on('error', (err) => {
    logger.error('Error en el túnel de Cloudflare:', err);
  });

  tunnel.on('exit', (code) => {
    logger.warn(`cloudflared finalizó (código ${code})`);
    process.exit(code || 0);
  });

  const shutdown = () => {
    logger.info('Deteniendo túnel...');
    tunnel.stop();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

main().catch((err) => {
  logger.error('devTunnel falló:', err);
  process.exit(1);
});
