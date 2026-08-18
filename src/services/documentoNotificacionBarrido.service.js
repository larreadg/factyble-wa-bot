const logger = require('../utils/logger');
const env = require('../utils/env');
const documentoService = require('./documento.service');
const documentoNotificacionService = require('./documentoNotificacion.service');

const safeError = (error) => ({ name: error?.name, message: error?.message });

// Cuántos documentos pendientes se procesan por vuelta: acota el trabajo de cada tick
// (cada envío hace descarga del PDF + subida a WhatsApp + mensaje) para no bloquear el
// proceso que además sirve el webhook. Lo que no entra en una vuelta se toma en la siguiente.
const LIMITE_POR_VUELTA = 20;

// Reintenta entregar el PDF de los documentos que se emitieron pero cuyo envío al cliente no
// se completó (notificado_en NULL) — típicamente porque el envío por WhatsApp falló o se
// colgó en el momento de emitir. Así el cliente termina recibiendo su factura/NC aunque el
// primer intento haya fallado, sin depender de una reintervención manual.
//
// Corre en el mismo proceso que el webhook (ver src/index.js, setInterval), así que nunca
// debe tirar: cada documento va en su propio try/catch para que una falla puntual (WhatsApp
// caído, PDF inaccesible) no aborte el resto del lote. Un documento que sigue fallando queda
// pendiente y se reintenta en la próxima vuelta, hasta que salga de la ventana de 24h.
const ejecutar = async () => {
  let pendientes;
  try {
    pendientes = await documentoService.listarPendientesDeNotificar({
      limite: LIMITE_POR_VUELTA,
      antiguedadMaximaMs: env.DOCUMENTO_NOTIF_VENTANA_MS,
    });
  } catch (error) {
    logger.error('Error listando documentos pendientes de notificar', safeError(error));
    return;
  }

  if (pendientes.length === 0) return;

  logger.info('Barrido de documentos pendientes de notificar', { total: pendientes.length });

  for (const documento of pendientes) {
    try {
      await documentoNotificacionService.enviarPdf(documento);
      await documentoService.marcarNotificado(documento.cdc);
      logger.info('PDF entregado al cliente por el barrido de notificaciones', { cdc: documento.cdc, tipo: documento.tipo });
    } catch (error) {
      logger.warn('No se pudo entregar el PDF (queda pendiente para el próximo barrido)', { ...safeError(error), cdc: documento.cdc });
    }
  }
};

module.exports = { ejecutar };
