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

// Marca que el PDF del documento ya se le entregó al cliente por WhatsApp (columna
// notificado_en). Es lo que evita que el barrido de notificaciones lo reenvíe (ver
// documentoNotificacionBarrido.service.js). updateMany (no update) por si el cdc no matchea
// ninguna fila (ej. el registro de emisión falló): no rompe, solo no actualiza nada.
const marcarNotificado = (cdc) =>
  prisma.documento.updateMany({
    where: { cdc },
    data: { notificadoEn: new Date() },
  });

// Documentos emitidos cuyo PDF todavía no se le pudo entregar al cliente (notificado_en NULL)
// y que tienen PDF para enviar. Se acota a los creados dentro de `antiguedadMaximaMs` porque
// fuera de la ventana de 24h de WhatsApp ya no se le puede mandar un mensaje libre al usuario,
// así que reintentar no tendría sentido. Orden estable por id (los más viejos primero).
const listarPendientesDeNotificar = ({ limite, antiguedadMaximaMs }) =>
  prisma.documento.findMany({
    where: {
      notificadoEn: null,
      pdfNombre: { not: null },
      fechaCreacion: { gte: new Date(Date.now() - antiguedadMaximaMs) },
    },
    orderBy: { id: 'asc' },
    take: limite,
  });

// Los documentos emitidos antes de que existiera este modelo no tienen fila propia:
// si el cdc no matchea ninguna, no hay nada que actualizar (no es un error).
const registrarCancelacion = (cdc, { estadoSifen, sifenEstadoMensaje }) =>
  prisma.documento.updateMany({
    where: { cdc },
    data: { estadoSifen: estadoSifen || null, sifenEstadoMensaje: sifenEstadoMensaje || null },
  });

// Actualiza cada documento del batch por (empresaId, cdc). Igual que registrarCancelacion,
// usa updateMany (no update): si el bulk-update recibe un cdc que no matchea ninguna fila
// (o no pertenece a esa empresa), no rompe el resto del batch, solo no actualiza nada.
// Solo deja el estado final de SIFEN registrado para auditoría: el PDF ya se le entregó
// al cliente al emitir (ver botOrchestrator.service.js), así que esto no dispara ningún aviso.
const actualizarEstados = (items) =>
  Promise.all(
    items.map(({ empresaId, cdc, estadoSifen, sifenEstadoMensaje }) =>
      prisma.documento.updateMany({
        where: { empresaId, cdc },
        data: { estadoSifen: estadoSifen || null, sifenEstadoMensaje: sifenEstadoMensaje || null },
      }),
    ),
  );

module.exports = { registrarEmision, marcarNotificado, listarPendientesDeNotificar, registrarCancelacion, actualizarEstados };
