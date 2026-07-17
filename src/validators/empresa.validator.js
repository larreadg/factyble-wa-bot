const { body } = require('express-validator');

const create = [
  body('ruc')
    .trim()
    .notEmpty().withMessage('ruc es requerido')
    .bail()
    .isString().withMessage('ruc debe ser un texto'),
  body('razonSocial')
    .trim()
    .notEmpty().withMessage('razonSocial es requerido')
    .bail()
    .isString().withMessage('razonSocial debe ser un texto'),
  body('usuario')
    .trim()
    .notEmpty().withMessage('usuario es requerido')
    .bail()
    .isString().withMessage('usuario debe ser un texto'),
  body('password')
    .notEmpty().withMessage('password es requerido')
    .bail()
    .isString().withMessage('password debe ser un texto'),
];

module.exports = { create };
