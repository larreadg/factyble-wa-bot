const prisma = require('../utils/prisma');
const env = require('../utils/env');
const { ESTADOS_SESION, ESTADOS_TERMINALES } = require('../utils/constants');
const { borradorVacio } = require('./facturaBorrador.service');

// Cuándo se da por perdida una sesión que quedó esperando algo del usuario sin
// resolverse (ver sesionBarrido.service.js). PROCESANDO expira mucho antes que el resto:
// normalmente se resuelve dentro del mismo request-response (segundos), así que tardar
// SESION_PROCESANDO_TIMEOUT_MS ahí casi seguro significa que el proceso se cayó a mitad
// de una emisión/cancelación, no que el usuario está pensando. Los estados terminales no
// expiran (fechaExpiracion queda en null: no hay nada pendiente del usuario).
const calcularFechaExpiracion = (estado) => {
  if (ESTADOS_TERMINALES.includes(estado)) return null;
  const timeoutMs = estado === ESTADOS_SESION.PROCESANDO ? env.SESION_PROCESANDO_TIMEOUT_MS : env.SESION_INACTIVA_TIMEOUT_MS;
  return new Date(Date.now() + timeoutMs);
};

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
      fechaExpiracion: calcularFechaExpiracion(ESTADOS_SESION.INICIO),
    },
  });
};

// Transición atómica de estado: solo aplica si el estado actual de la fila coincide con
// uno de `estadosDesde`. Devuelve la sesión actualizada si tuvo efecto, o null si otro
// proceso ya había cambiado el estado (ej. doble confirmación concurrente, o
// sesionBarrido.service.js cerrándola por inactividad justo en ese momento).
const transicionar = async (sesionId, estadosDesde, estadoHasta, datosTemporales, ultimoMensajeId) => {
  const resultado = await prisma.sesionConversacional.updateMany({
    where: { id: sesionId, estado: { in: estadosDesde } },
    data: {
      estado: estadoHasta,
      fechaExpiracion: calcularFechaExpiracion(estadoHasta),
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
      fechaExpiracion: calcularFechaExpiracion(ESTADOS_SESION.INICIO),
    },
  });
};

// Fija qué operación del menú principal está activa para la conversación (o la
// limpia con null). Es independiente de `estado` (la máquina de estados del flujo
// de emisión), así que se persiste aparte en vez de con `transicionar`. Solo se llama
// mientras la sesión sigue en INICIO (ver botOrchestrator.service.js), así que
// recalcula la expiración para ese estado.
const setOperacionActiva = (sesionId, operacionActiva) => {
  return prisma.sesionConversacional.update({
    where: { id: sesionId },
    data: { operacionActiva, fechaExpiracion: calcularFechaExpiracion(ESTADOS_SESION.INICIO) },
  });
};

// Como setOperacionActiva, pero además inicializa estado=INICIO y datosTemporales con
// el borrador vacío propio de la operación elegida: cada operación (factura, nota de
// crédito) tiene su propia forma de borrador, así que no alcanza con solo cambiar
// operacionActiva si datosTemporales todavía tiene la forma de otra operación.
const iniciarOperacion = (sesionId, operacionActiva, datosTemporales) => {
  return prisma.sesionConversacional.update({
    where: { id: sesionId },
    data: { operacionActiva, estado: ESTADOS_SESION.INICIO, datosTemporales, fechaExpiracion: calcularFechaExpiracion(ESTADOS_SESION.INICIO) },
  });
};

// Sesiones no terminales candidatas a que sesionBarrido.service.js las cierre por
// inactividad: fechaExpiracion ya pasada, o (fallback para filas creadas antes de que
// este campo se empezara a usar) sin fechaExpiracion pero con fechaModificacion vieja.
// Incluye conversacion+contacto porque el barrido los necesita para exportar el detalle
// de chat a Telegram.
const listarExpiradas = (estados) => {
  const ahora = new Date();
  const limiteLegado = new Date(Date.now() - env.SESION_INACTIVA_TIMEOUT_MS);

  return prisma.sesionConversacional.findMany({
    where: {
      estado: { in: estados },
      OR: [{ fechaExpiracion: { lt: ahora } }, { fechaExpiracion: null, fechaModificacion: { lt: limiteLegado } }],
    },
    include: { conversacion: { include: { contacto: true } } },
  });
};

module.exports = { getOrCreateSesion, transicionar, resetSesion, setOperacionActiva, iniciarOperacion, listarExpiradas };
