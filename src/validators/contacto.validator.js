const { body } = require('express-validator');

const create = [
  body('empresaRuc')
    .trim()
    .notEmpty().withMessage('empresaRuc es requerido')
    .bail()
    .isString().withMessage('empresaRuc debe ser un texto'),
  body('numeroTelefono')
    .trim()
    .notEmpty().withMessage('numeroTelefono es requerido')
    .bail()
    .matches(/^\d{6,15}$/).withMessage('numeroTelefono debe contener solo dígitos (6-15)'),
  body('nombre')
    .optional({ nullable: true })
    .trim()
    .isString().withMessage('nombre debe ser un texto'),
];

module.exports = { create };
