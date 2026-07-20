const prisma = require('../utils/prisma');

const registrarEmision = ({
  empresaId,
  numeroTelefono,
  tipo,
  cdc,
  pdfNombre,
  numeroDocumentoFormateado,
  clienteNombre,
  clienteDocumento,
  estadoSifen,
  sifenEstadoMensaje,
}) =>
  prisma.documento.create({
    data: {
      empresaId,
      numeroTelefono,
      tipo,
      cdc,
      pdfNombre: pdfNombre || null,
      numeroDocumentoFormateado: numeroDocumentoFormateado || null,
      clienteNombre: clienteNombre || null,
      clienteDocumento: clienteDocumento || null,
      estadoSifen: estadoSifen || null,
      sifenEstadoMensaje: sifenEstadoMensaje || null,
    },
  });

// Los documentos emitidos antes de que existiera este modelo no tienen fila propia:
// si el cdc no matchea ninguna, no hay nada que actualizar (no es un error).
const registrarCancelacion = (cdc, { estadoSifen, sifenEstadoMensaje }) =>
  prisma.documento.updateMany({
    where: { cdc },
    data: { estadoSifen: estadoSifen || null, sifenEstadoMensaje: sifenEstadoMensaje || null },
  });

// Estados finales tras los que hay que avisarle al cliente el resultado (ver
// documentoNotificacion.service.js). GENERADO/FIRMANDO/FIRMADO/ENCOLADO/ENVIADO son
// transitorios y CANCELADO se maneja aparte, ya en el flujo de cancelación del bot.
const ESTADOS_FINALES = ['APROBADO', 'RECHAZADO', 'ERROR'];

// Actualiza cada documento del batch por (empresaId, cdc). Igual que registrarCancelacion,
// usa updateMany (no update): si el bulk-update recibe un cdc que no matchea ninguna fila
// (o no pertenece a esa empresa), no rompe el resto del batch, solo no actualiza nada.
const actualizarEstados = (items) =>
  Promise.all(
    items.map(({ empresaId, cdc, estadoSifen, sifenEstadoMensaje }) =>
      prisma.documento.updateMany({
        where: { empresaId, cdc },
        data: { estadoSifen: estadoSifen || null, sifenEstadoMensaje: sifenEstadoMensaje || null },
      }),
    ),
  );

// Se re-evalúa toda la tabla (no solo el batch recibido en este request) para que un
// aviso que falló en una corrida anterior (ej. WhatsApp caído) se reintente en la
// siguiente llamada a bulk-update, en vez de perderse.
const listarPendientesDeNotificar = () => prisma.documento.findMany({ where: { estadoSifen: { in: ESTADOS_FINALES }, notificadoEn: null } });

const marcarNotificado = (id) => prisma.documento.update({ where: { id }, data: { notificadoEn: new Date() } });

module.exports = { registrarEmision, registrarCancelacion, actualizarEstados, listarPendientesDeNotificar, marcarNotificado };
