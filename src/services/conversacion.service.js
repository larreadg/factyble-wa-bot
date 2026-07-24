const prisma = require('../utils/prisma');

// Recupera la conversación ABIERTA del contacto o crea una nueva. Dos webhooks casi
// simultáneos pueden intentar crearla a la vez: el índice único sobre la columna
// generada `contacto_id_abierta` (ver migration.sql) garantiza que solo una gane; el
// otro proceso recupera acá la conversación creada por el ganador (P2002).
const getOrCreateAbierta = async (contactoId) => {
  const abierta = await prisma.conversacion.findFirst({ where: { contactoId, estado: 'ABIERTA' } });
  if (abierta) return abierta;

  try {
    const ahora = new Date();
    return await prisma.conversacion.create({
      data: { contactoId, estado: 'ABIERTA', fechaInicio: ahora, fechaUltimoMensaje: ahora },
    });
  } catch (error) {
    if (error.code === 'P2002') {
      const existente = await prisma.conversacion.findFirst({ where: { contactoId, estado: 'ABIERTA' } });
      if (existente) return existente;
    }
    throw error;
  }
};

const actualizarUltimoMensaje = (conversacionId, fecha = new Date()) => {
  return prisma.conversacion.update({
    where: { id: conversacionId },
    data: { fechaUltimoMensaje: fecha },
  });
};

// Marca hasta qué Mensaje ya se incluyó en un detalle de chat enviado a Telegram, para
// que el próximo export (otra operación sobre la misma Conversacion, que nunca se
// cierra) arranque desde ahí en vez de reenviar todo de nuevo (ver chatExport.service.js).
const marcarExportado = (conversacionId, ultimoMensajeExportadoId) => {
  return prisma.conversacion.update({
    where: { id: conversacionId },
    data: { ultimoMensajeExportadoId },
  });
};

module.exports = { getOrCreateAbierta, actualizarUltimoMensaje, marcarExportado };
