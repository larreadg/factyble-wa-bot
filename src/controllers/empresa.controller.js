const empresaService = require('../services/empresa.service');
const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');
const Response = require('../utils/response');

const create = async (req, res) => {
  const { ruc, razonSocial, usuario, password } = req.body;

  try {
    const empresa = await empresaService.createEmpresa({ ruc, razonSocial, usuario, password });
    const response = Response.success(empresa, 'Empresa creada exitosamente', 201);
    res.status(response.code).json(response);
  } catch (error) {
    if (error instanceof AppError) {
      const response = Response.error(error.message, error.statusCode);
      return res.status(response.code).json(response);
    }

    logger.error('Error al crear empresa', error);
    const response = Response.error('Error interno del servidor', 500);
    res.status(response.code).json(response);
  }
};

module.exports = { create };
