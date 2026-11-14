const prisma = require('../utils/prisma');

// Registro idempotente de un mensaje entrante: whatsappMensajeId es @unique, así que un
// webhook reentregado por Meta (mismo wamid) cae en P2002 y se recupera el registro
// existente en vez de crear uno nuevo o volver a invocar a OpenAI/emitir de nuevo.
const registrarEntrante = async ({ conversacionId, whatsappMensajeId, tipo, contenidoTexto, fechaMensaje }) => {
  try {
    const mensaje = await prisma.mensaje.create({
      data: {
        conversacionId,
        whatsappMensajeId,
        direccion: 'ENTRANTE',
        tipo,
        contenidoTexto,
        estado: 'RECIBIDO',
        fechaMensaje,
      },
    });
    return { mensaje, duplicado: false };
  } catch (error) {
    if (error.code === 'P2002' && whatsappMensajeId) {
      const existente = await prisma.mensaje.findUnique({ where: { whatsappMensajeId } });
      if (existente) return { mensaje: existente, duplicado: true };
    }
    throw error;
  }
};

const registrarSaliente = ({ conversacionId, tipo, contenidoTexto, estado, whatsappMensajeId = null }) => {
  return prisma.mensaje.create({
    data: {
      conversacionId,
      whatsappMensajeId,
      direccion: 'SALIENTE',
      tipo,
      contenidoTexto,
      estado,
      fechaMensaje: new Date(),
    },
  });
};

const actualizarEstadoPorWhatsappId = async (whatsappMensajeId, estado) => {
  if (!whatsappMensajeId || !estado) return;
  await prisma.mensaje.updateMany({ where: { whatsappMensajeId }, data: { estado } });
};

// Fotos entrantes de una conversación que llegaron entre `desde` y `hasta`. Se filtra por
// fechaCreacion (hora en que recibimos el webhook, con milisegundos) y no por fechaMensaje (hora
// de Meta, con precisión de segundos): sirve para detectar varias fotos mandadas juntas, que
// WhatsApp entrega como mensajes separados con uno o dos segundos de diferencia (ver
// manejarImagenEntrante en botOrchestrator.service.js). `fechaMensajeMinima` deja afuera las
// reentregas demoradas del webhook, que se registran pero nunca se procesan.
const listarImagenesEntrantesEntre = (conversacionId, desde, hasta, fechaMensajeMinima) => {
  return prisma.mensaje.findMany({
    where: {
      conversacionId,
      direccion: 'ENTRANTE',
      tipo: 'IMAGEN',
      fechaCreacion: { gte: desde, lte: hasta },
      ...(fechaMensajeMinima ? { fechaMensaje: { gte: fechaMensajeMinima } } : {}),
    },
    select: { id: true, fechaCreacion: true },
    orderBy: { id: 'asc' },
  });
};

const crearArchivo = ({ mensajeId, whatsappMediaId, nombreArchivo, mimeType, tamanioBytes, rutaArchivo, transcripcion }) => {
  return prisma.mensajeArchivo.create({
    data: { mensajeId, whatsappMediaId, nombreArchivo, mimeType, tamanioBytes, rutaArchivo, transcripcion },
  });
};

// Mensajes de una conversación posteriores a `desdeMensajeId` (exclusivo), para armar el
// detalle de chat que se envía a Telegram (ver chatExport.service.js). desdeMensajeId
// null/undefined trae toda la conversación (primer export).
const listarParaExportar = (conversacionId, desdeMensajeId) => {
  return prisma.mensaje.findMany({
    where: { conversacionId, ...(desdeMensajeId ? { id: { gt: desdeMensajeId } } : {}) },
    orderBy: { fechaMensaje: 'asc' },
    include: { archivo: true },
  });
};

module.exports = { registrarEntrante, registrarSaliente, actualizarEstadoPorWhatsappId, crearArchivo, listarParaExportar, listarImagenesEntrantesEntre };
