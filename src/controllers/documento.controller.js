const documentoService = require('../services/documento.service');
const documentoNotificacionService = require('../services/documentoNotificacion.service');
const logger = require('../utils/logger');
const Response = require('../utils/response');

const safeError = (error) => ({ name: error?.name, message: error?.message });

// Best-effort y no bloquea la respuesta HTTP: se re-evalúa toda la tabla (no solo el
// batch de este request, ver documento.service.js) y enviar cada aviso puede tardar
// (descarga de PDF + subida a WhatsApp), así que el caller no necesita esperarlo.
const notificarPendientes = async () => {
  let pendientes;

  try {
    pendientes = await documentoService.listarPendientesDeNotificar();
  } catch (error) {
    logger.error('Error listando documentos pendientes de notificar', safeError(error));
    return;
  }

  for (const documento of pendientes) {
    try {
      await documentoNotificacionService.enviarPorEstado(documento);
      await documentoService.marcarNotificado(documento.id);
    } catch (error) {
      logger.error('Error notificando documento al cliente', { ...safeError(error), documentoId: documento.id, cdc: documento.cdc });
    }
  }
};

const bulkUpdate = async (req, res) => {
  const items = req.body;

  let resultados;
  try {
    resultados = await documentoService.actualizarEstados(items);
  } catch (error) {
    logger.error('Error actualizando estados de documentos', safeError(error));
    const response = Response.error('Error interno del servidor', 500);
    return res.status(response.code).json(response);
  }

  const actualizados = resultados.reduce((total, { count }) => total + count, 0);
  const response = Response.success({ actualizados }, 'Estados actualizados');
  res.status(response.code).json(response);

  notificarPendientes();
};

module.exports = { bulkUpdate };
