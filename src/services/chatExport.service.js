const logger = require('../utils/logger');
const { construirTranscripcion } = require('../utils/chatTranscripcion');
const mensajeService = require('./mensaje.service');
const conversacionService = require('./conversacion.service');
const telegramService = require('./telegram.service');

const nombreArchivo = (contacto) => `chat_${contacto.numeroTelefono}_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;

// Llamada desde botOrchestrator.service.js (fire-and-forget, sin await) cuando una
// SesionConversacional llega a un estado terminal, y desde sesionBarrido.service.js
// (awaited, en un barrido de background) cuando una sesión se cierra por inactividad o
// por quedar atascada en PROCESANDO. Ninguno de los dos callers puede permitirse que
// esto tire: el primero no debe interrumpir la respuesta al usuario final, el segundo no
// debe abortar el resto del lote. Por eso atrapa acá cualquier error (Telegram caído,
// token inválido, etc.) y solo lo loguea, en vez de dejarlo propagarse.
//
// Si el envío falla, ultimoMensajeExportadoId no se actualiza: los mensajes de esta
// operación quedan pendientes y se incluyen en el próximo export de la misma
// Conversacion (que nunca se cierra), en vez de perderse.
const exportar = async ({ conversacion, contacto, operacion, resultado, advertencia }) => {
  try {
    const mensajes = await mensajeService.listarParaExportar(conversacion.id, conversacion.ultimoMensajeExportadoId);
    if (mensajes.length === 0) return;

    const contenidoTexto = construirTranscripcion({ contacto, operacion, resultado, mensajes, advertencia });
    const caption = `${operacion}: ${resultado.replace(/_/g, ' ')} — ${contacto.nombre || contacto.numeroTelefono}`;

    await telegramService.enviarDocumento({ nombreArchivo: nombreArchivo(contacto), contenidoTexto, caption });
    await conversacionService.marcarExportado(conversacion.id, mensajes[mensajes.length - 1].id);
  } catch (error) {
    logger.error('Error exportando detalle de chat a Telegram', { name: error?.name, message: error?.message });
  }
};

module.exports = { exportar };
