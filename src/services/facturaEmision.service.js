const logger = require('../utils/logger');
const facturaApiService = require('./facturaApi.service');
const whatsappService = require('./whatsapp.service');
const { FacturaApiError } = require('./facturaApi.errors');
const { obtenerToken, autenticarYGuardar } = require('./facturacionAuth.service');

const construirPayload = ({ cliente, condicionVenta, items }) => ({
  // RUC -> CONTRIBUYENTE, cédula (CI) -> NO_CONTRIBUYENTE (ver contrato de POST /factura/simple).
  situacionTributaria: cliente.tipoDocumento === 'CI' ? 'NO_CONTRIBUYENTE' : 'CONTRIBUYENTE',
  personaDocumento: cliente.numeroDocumento,
  personaNombre: cliente.nombre,
  condicionVenta,
  items: items.map(({ cantidad, precioUnitario, tasa, descripcion }) => ({
    cantidad,
    precioUnitario,
    tasa,
    descripcion,
  })),
});

/**
 * @param {{ empresa: object, cliente: {nombre: string, tipoDocumento: 'RUC'|'CI', numeroDocumento: string}, condicionVenta: 'CONTADO'|'CREDITO', items: Array<{descripcion: string, cantidad: number, precioUnitario: number, tasa: '0%'|'5%'|'10%'}>, totales: {subtotal: number, totalGeneral: number}, idempotencyKey: string }} params
 * @returns {Promise<{ documentoId: string, numero: string, pdfMediaId?: string, nombreArchivo?: string, pdfTamanioBytes?: number }>}
 */
const emitirFactura = async ({ empresa, cliente, condicionVenta, items, idempotencyKey }) => {
  const payload = construirPayload({ cliente, condicionVenta, items });

  let token = await obtenerToken(empresa);
  let data;

  try {
    data = await facturaApiService.emitirFacturaSimple(token, payload);
  } catch (error) {
    if (!(error instanceof FacturaApiError) || error.type !== 'AUTH_FAILED') {
      throw error;
    }

    // El token cacheado pudo quedar inválido (revocado, reloj desincronizado, etc.):
    // reautenticar una única vez y reintentar antes de propagar el error.
    logger.info('Token de facturación rechazado, reautenticando', { empresaId: empresa.id, idempotencyKey });
    token = await autenticarYGuardar(empresa);
    data = await facturaApiService.emitirFacturaSimple(token, payload);
  }

  const pdfNombre = data?.pdfNombre;
  let pdfMediaId = null;
  let pdfTamanioBytes = null;

  if (pdfNombre) {
    const pdfBuffer = await facturaApiService.descargarPdf(pdfNombre);
    pdfTamanioBytes = pdfBuffer.length;

    const media = await whatsappService.uploadMedia(pdfBuffer, pdfNombre, 'application/pdf');
    pdfMediaId = media?.id || null;
  } else {
    logger.error('La API de facturación no devolvió pdfNombre', { empresaId: empresa.id, idempotencyKey });
  }

  return {
    documentoId: data?.id ?? null,
    numero: data?.numero_factura ?? null,
    pdfMediaId,
    nombreArchivo: pdfNombre || null,
    pdfTamanioBytes,
  };
};

module.exports = { emitirFactura };
