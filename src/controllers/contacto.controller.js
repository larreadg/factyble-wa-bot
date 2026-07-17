const contactoService = require('../services/contacto.service');
const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');
const Response = require('../utils/response');

const create = async (req, res) => {
  const { empresaRuc, nombre, numeroTelefono } = req.body;

  try {
    const contacto = await contactoService.createContacto({ empresaRuc, nombre, numeroTelefono });
    const response = Response.success(contacto, 'Contacto creado exitosamente', 201);
    res.status(response.code).json(response);
  } catch (error) {
    if (error instanceof AppError) {
      const response = Response.error(error.message, error.statusCode);
      return res.status(response.code).json(response);
    }

    logger.error('Error al crear contacto', error);
    const response = Response.error('Error interno del servidor', 500);
    res.status(response.code).json(response);
  }
};

module.exports = { create };
