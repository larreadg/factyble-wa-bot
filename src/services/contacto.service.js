const prisma = require('../utils/prisma');
const { AppError } = require('../utils/errors');

const createContacto = async ({ empresaRuc, nombre, numeroTelefono }) => {
  const empresa = await prisma.empresa.findUnique({ where: { ruc: empresaRuc } });

  if (!empresa) {
    throw new AppError('No existe una empresa con ese RUC', 404);
  }

  const existente = await prisma.contacto.findUnique({ where: { numeroTelefono } });

  if (existente) {
    throw new AppError('Ya existe un contacto con ese número de teléfono', 409);
  }

  return prisma.contacto.create({
    data: {
      empresaId: empresa.id,
      numeroTelefono,
      nombre,
    },
  });
};

const findContactoActivoByNumero = (numeroTelefono) => {
  return prisma.contacto.findFirst({
    where: { numeroTelefono, activo: true },
    include: { empresa: true },
  });
};

module.exports = { createContacto, findContactoActivoByNumero };
