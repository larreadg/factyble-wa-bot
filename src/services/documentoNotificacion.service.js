const facturaApiService = require('./facturaApi.service');
const whatsappService = require('./whatsapp.service');
const { construirCaptionPdf } = require('../utils/documentoPresentacion');

// Descarga el PDF (GET /public/<pdfNombre> es un endpoint público, ver facturaApi.service.js:
// no hace falta autenticarse para bajarlo) y lo envía al cliente por WhatsApp con su caption.
//
// Se llama de forma SÍNCRONA apenas se emite (ver botOrchestrator.service.js): la
// factura/NC queda FIRMADA y el PDF ya está escrito en disco cuando /factura/simple
// responde, así que no se espera la aprobación asíncrona de SIFEN para entregarlo. SIFEN
// aprueba con demoras y de forma poco fiable; el cliente prefiere el PDF firmado al toque.
const enviarPdf = async (documento) => {
  if (!documento.pdfNombre) {
    throw new Error(`Documento (cdc ${documento.cdc}) no tiene pdfNombre: no hay PDF para enviar`);
  }

  const pdfBuffer = await facturaApiService.descargarPdf(documento.pdfNombre);
  const media = await whatsappService.uploadMedia(pdfBuffer, documento.pdfNombre, 'application/pdf');

  await whatsappService.sendDocumentMessage(documento.numeroTelefono, {
    id: media?.id,
    filename: documento.pdfNombre,
    caption: construirCaptionPdf(documento),
  });
};

module.exports = { enviarPdf };
