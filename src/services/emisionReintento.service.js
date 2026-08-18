const logger = require('../utils/logger');
const sesionConversacionalService = require('./sesionConversacional.service');
const botOrchestrator = require('./botOrchestrator.service');

const safeError = (error) => ({ name: error?.name, message: error?.message });

// Barrido de reintentos de emisión: toma las sesiones agendadas para reintento
// (estado REINTENTANDO_EMISION) cuyo próximo intento ya venció y las reintenta una por una.
// Corre en el mismo proceso que el webhook (ver src/index.js, setInterval), así que nunca
// debe tirar: cada sesión va en su propio try/catch. La cadencia real (cada cuántos minutos
// se reintenta cada factura y cuántas veces) la define la sesión misma vía fechaExpiracion +
// el contador de intentos (ver botOrchestrator.reintentarEmisionPendiente y env.js).
const ejecutar = async () => {
  let pendientes;
  try {
    pendientes = await sesionConversacionalService.listarEmisionesPendientesDeReintento();
  } catch (error) {
    logger.error('Error listando emisiones pendientes de reintento', safeError(error));
    return;
  }

  if (pendientes.length === 0) return;

  logger.info('Barrido de reintentos de emisión', { total: pendientes.length });

  for (const sesion of pendientes) {
    try {
      await botOrchestrator.reintentarEmisionPendiente(sesion);
    } catch (error) {
      logger.error('Error reintentando una emisión pendiente', { sesionId: sesion.id, ...safeError(error) });
    }
  }
};

module.exports = { ejecutar };
