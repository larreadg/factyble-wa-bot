const prisma = require('../utils/prisma');
const { ESTADOS_SESION } = require('../utils/constants');
const { borradorVacio } = require('./facturaBorrador.service');

// SesionConversacional tiene relación 1:1 con Conversacion (conversacionId es @unique),
// por lo que un upsert sobre esa clave es atómico en MySQL (INSERT ... ON DUPLICATE KEY
// UPDATE) y no necesita manejo manual de carrera como Conversacion.
const getOrCreateSesion = (conversacionId) => {
  return prisma.sesionConversacional.upsert({
    where: { conversacionId },
    update: {},
    create: {
      conversacionId,
      estado: ESTADOS_SESION.INICIO,
      datosTemporales: borradorVacio(),
    },
  });
};

// Transición atómica de estado: solo aplica si el estado actual de la fila coincide con
// uno de `estadosDesde`. Devuelve la sesión actualizada si tuvo efecto, o null si otro
// proceso ya había cambiado el estado (ej. doble confirmación concurrente).
const transicionar = async (sesionId, estadosDesde, estadoHasta, datosTemporales, ultimoMensajeId) => {
  const resultado = await prisma.sesionConversacional.updateMany({
    where: { id: sesionId, estado: { in: estadosDesde } },
    data: {
      estado: estadoHasta,
      ...(datosTemporales !== undefined ? { datosTemporales } : {}),
      ...(ultimoMensajeId !== undefined ? { ultimoMensajeId } : {}),
    },
  });

  if (resultado.count !== 1) return null;

  return prisma.sesionConversacional.findUnique({ where: { id: sesionId } });
};

const resetSesion = (sesionId) => {
  return prisma.sesionConversacional.update({
    where: { id: sesionId },
    data: {
      estado: ESTADOS_SESION.INICIO,
      intencionActual: null,
      operacionActiva: null,
      datosTemporales: borradorVacio(),
    },
  });
};

// Fija qué operación del menú principal está activa para la conversación (o la
// limpia con null). Es independiente de `estado` (la máquina de estados del flujo
// de emisión), así que se persiste aparte en vez de con `transicionar`.
const setOperacionActiva = (sesionId, operacionActiva) => {
  return prisma.sesionConversacional.update({
    where: { id: sesionId },
    data: { operacionActiva },
  });
};

// Como setOperacionActiva, pero además inicializa estado=INICIO y datosTemporales con
// el borrador vacío propio de la operación elegida: cada operación (factura, nota de
// crédito) tiene su propia forma de borrador, así que no alcanza con solo cambiar
// operacionActiva si datosTemporales todavía tiene la forma de otra operación.
const iniciarOperacion = (sesionId, operacionActiva, datosTemporales) => {
  return prisma.sesionConversacional.update({
    where: { id: sesionId },
    data: { operacionActiva, estado: ESTADOS_SESION.INICIO, datosTemporales },
  });
};

module.exports = { getOrCreateSesion, transicionar, resetSesion, setOperacionActiva, iniciarOperacion };
