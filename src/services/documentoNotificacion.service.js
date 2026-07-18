const facturaApiService = require('./facturaApi.service');
const whatsappService = require('./whatsapp.service');
const { construirMensajeRechazado, construirMensajeError } = require('../utils/documentoPresentacion');

// GET /public/<pdfNombre> es un endpoint público (ver facturaApi.service.js): no hace
// falta autenticarse contra la API de facturación para descargar el PDF acá.
const enviarAprobado = async (documento) => {
  if (!documento.pdfNombre) {
    throw new Error(`Documento ${documento.id} (cdc ${documento.cdc}) está APROBADO pero no tiene pdfNombre`);
  }

  const pdfBuffer = await facturaApiService.descargarPdf(documento.pdfNombre);
  const media = await whatsappService.uploadMedia(pdfBuffer, documento.pdfNombre, 'application/pdf');

  await whatsappService.sendDocumentMessage(documento.numeroTelefono, {
    id: media?.id,
    filename: documento.pdfNombre,
    caption: documento.numeroDocumentoFormateado || undefined,
  });
};

const enviarPorEstado = (documento) => {
  if (documento.estadoSifen === 'APROBADO') return enviarAprobado(documento);
  if (documento.estadoSifen === 'RECHAZADO') return whatsappService.sendTextMessage(documento.numeroTelefono, construirMensajeRechazado(documento));
  if (documento.estadoSifen === 'ERROR') return whatsappService.sendTextMessage(documento.numeroTelefono, construirMensajeError(documento));
  return Promise.resolve();
};

module.exports = { enviarPorEstado };
