const logger = require('../utils/logger');
const { ESTADOS_SESION } = require('../utils/constants');
const sesionConversacionalService = require('./sesionConversacional.service');
const chatExportService = require('./chatExport.service');

const safeError = (error) => ({ name: error?.name, message: error?.message });

// Estados no terminales que pueden expirar (fechaExpiracion, seteada en cada transición
// por sesionConversacional.service.js). PROCESANDO se trata distinto de los demás: su
// expiración es mucho más corta y significa "el proceso probablemente se cayó a mitad de
// una emisión/cancelación", no "el usuario dejó de responder".
const ESTADOS_EXPIRABLES = [
  ESTADOS_SESION.INICIO,
  ESTADOS_SESION.CAPTURANDO_DATOS,
  ESTADOS_SESION.ESPERANDO_CONFIRMACION,
  ESTADOS_SESION.PROCESANDO,
];

const ADVERTENCIA_PROCESANDO_ATASCADA =
  '⚠️ Esta sesión quedó en PROCESANDO sin resolverse (posible caída del proceso a mitad de una emisión/cancelación). ' +
  'Verificar manualmente en el backend de facturación / SIFEN si la operación se completó antes de asumir que no ocurrió.';

const cerrarPorExpiracion = async (sesion) => {
  const procesandoAtascada = sesion.estado === ESTADOS_SESION.PROCESANDO;
  const estadoHasta = procesandoAtascada ? ESTADOS_SESION.ERROR : ESTADOS_SESION.CANCELADA;
  const resultado = procesandoAtascada ? 'POSIBLE_FALLO_TECNICO' : 'ABANDONADO';

  // Transición atómica guardada por el estado con el que se leyó la sesión (mismo patrón
  // que botOrchestrator.service.js): si el usuario mandó un mensaje justo entre la
  // consulta y este paso, la sesión ya cambió de estado y esta transición no aplica, así
  // que no se pisa una interacción real en curso.
  const actualizada = await sesionConversacionalService.transicionar(sesion.id, [sesion.estado], estadoHasta);
  if (!actualizada) return;

  await chatExportService.exportar({
    conversacion: sesion.conversacion,
    contacto: sesion.conversacion.contacto,
    operacion: sesion.operacionActiva || 'SIN_OPERACION',
    resultado,
    advertencia: procesandoAtascada ? ADVERTENCIA_PROCESANDO_ATASCADA : undefined,
  });
};

// Punto de entrada del barrido periódico (ver src/index.js, setInterval). Nunca debe
// tirar: corre en el mismo proceso que sirve el webhook de WhatsApp, así que un error acá
// no puede tumbar el resto de la app. Cada sesión se procesa en su propio try/catch para
// que una falla puntual (ej. Telegram caído en esa vuelta) no aborte el resto del lote.
const ejecutar = async () => {
  let candidatas;
  try {
    candidatas = await sesionConversacionalService.listarExpiradas(ESTADOS_EXPIRABLES);
  } catch (error) {
    logger.error('Error listando sesiones expiradas', safeError(error));
    return;
  }

  if (candidatas.length === 0) return;

  logger.info('Barrido de sesiones expiradas', { total: candidatas.length });

  for (const sesion of candidatas) {
    try {
      await cerrarPorExpiracion(sesion);
    } catch (error) {
      logger.error('Error cerrando sesión expirada', { ...safeError(error), sesionId: sesion.id });
    }
  }
};

module.exports = { ejecutar };
