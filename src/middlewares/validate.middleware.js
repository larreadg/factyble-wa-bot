const { validationResult } = require('express-validator');
const Response = require('../utils/response');

module.exports = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const response = Response.error('Error de validación', 400, errors.array());
    return res.status(response.code).json(response);
  }

  next();
};
