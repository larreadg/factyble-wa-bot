const documentoService = require('../services/documento.service');
const logger = require('../utils/logger');
const Response = require('../utils/response');

const safeError = (error) => ({ name: error?.name, message: error?.message });

// Deja registrado en la tabla el estado final que SIFEN le asigna a cada documento
// (APROBADO/RECHAZADO/ERROR), para auditoría. Ya NO envía nada al cliente: el PDF se le
// entrega de forma síncrona al emitir (ver botOrchestrator.service.js), sin esperar la
// aprobación asíncrona de SIFEN.
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
};

module.exports = { bulkUpdate };
