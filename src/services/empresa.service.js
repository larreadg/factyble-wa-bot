const prisma = require('../utils/prisma');
const { AppError } = require('../utils/errors');
const crypto = require('../utils/crypto');

// No devolver password/token cifrados en las respuestas de la API.
const sanitizarEmpresa = ({ password, token, ...empresa }) => empresa;

const createEmpresa = async ({ ruc, razonSocial, usuario, password }) => {
  const existente = await prisma.empresa.findUnique({ where: { ruc } });

  if (existente) {
    throw new AppError('Ya existe una empresa con ese RUC', 409);
  }

  const empresa = await prisma.empresa.create({
    data: { ruc, razonSocial, usuario, password: crypto.encrypt(password) },
  });

  return sanitizarEmpresa(empresa);
};

// Persiste el token (JWT) obtenido de la API de facturación externa junto con su
// vencimiento, para no tener que reautenticarse en cada factura emitida.
const guardarToken = async (empresaId, { token, tokenExpiracion }) => {
  await prisma.empresa.update({ where: { id: empresaId }, data: { token, tokenExpiracion } });
};

module.exports = { createEmpresa, guardarToken };
