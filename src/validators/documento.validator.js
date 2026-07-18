const { body } = require('express-validator');

// Mismo enum que EstadoSifenDocumento en prisma/schema.prisma.
const ESTADOS_SIFEN_VALIDOS = ['GENERADO', 'FIRMANDO', 'FIRMADO', 'ENCOLADO', 'ENVIADO', 'APROBADO', 'RECHAZADO', 'ERROR', 'CANCELADO'];

// El body es directamente un array (no un objeto con una propiedad array): express-validator
// soporta esto validando el root con body() y cada ítem con el wildcard 'body(*.campo)'.
const bulkUpdate = [
  body().isArray({ min: 1 }).withMessage('El body debe ser un array con al menos un elemento'),
  body('*.empresaId')
    .notEmpty().withMessage('empresaId es requerido')
    .bail()
    .isInt({ min: 1 }).withMessage('empresaId debe ser un entero positivo')
    .toInt(),
  body('*.cdc')
    .trim()
    .notEmpty().withMessage('cdc es requerido')
    .bail()
    .isString().withMessage('cdc debe ser un texto')
    .bail()
    .isLength({ min: 44, max: 44 }).withMessage('cdc debe tener 44 caracteres'),
  body('*.estadoSifen')
    .notEmpty().withMessage('estadoSifen es requerido')
    .bail()
    .isIn(ESTADOS_SIFEN_VALIDOS).withMessage('estadoSifen inválido'),
  body('*.sifenEstadoMensaje')
    .optional({ nullable: true })
    .isString().withMessage('sifenEstadoMensaje debe ser un texto'),
];

module.exports = { bulkUpdate };
