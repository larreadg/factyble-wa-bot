const facturaApiService = require('./facturaApi.service');
const { obtenerToken, autenticarYGuardar } = require('./facturacionAuth.service');
const { FacturaApiError } = require('./facturaApi.errors');

// Igual patrón que facturaEmision.service.js: si el token cacheado es rechazado
// (revocado, reloj desincronizado, etc.), reautentica una única vez y reintenta antes
// de propagar el error.
const conReintentoAuth = async (empresa, llamarConToken) => {
  const token = await obtenerToken(empresa);

  try {
    return await llamarConToken(token);
  } catch (error) {
    if (!(error instanceof FacturaApiError) || error.type !== 'AUTH_FAILED') {
      throw error;
    }

    const nuevoToken = await autenticarYGuardar(empresa);
    return await llamarConToken(nuevoToken);
  }
};

/**
 * @returns {Promise<{ cdc: string, total: number, totalIva: number }>}
 */
const consultarTotalFactura = (empresa, cdc) => conReintentoAuth(empresa, (token) => facturaApiService.consultarTotalFactura(token, cdc));

/**
 * No descarga ni envía el PDF: igual que la factura, queda FIRMADA pero pendiente de
 * aprobación en SIFEN (ver comentario en facturaEmision.service.js).
 * @param {{ empresa: object, cdc: string, items: Array<{descripcion: string, cantidad: number, precioUnitario: number, tasa: '0%'|'5%'|'10%'}> }} params
 * @returns {Promise<{ documentoId: string, numero: string, numeroFormateado: string, cdc: string, pdfNombre: string, estadoSifen: string, sifenEstadoMensaje: string, linkQr: string }>}
 */
const emitirNotaCredito = async ({ empresa, cdc, items }) => {
  // Body exacto {cdc, items}, sin campos extra (ni idempotencyKey: el endpoint no lo
  // acepta). La protección contra doble emisión concurrente es la transición atómica de
  // estado en la sesión conversacional, no un campo enviado a esta API.
  const payload = {
    cdc,
    items: items.map(({ cantidad, precioUnitario, descripcion, tasa }) => ({ cantidad, precioUnitario, descripcion, tasa })),
  };

  const data = await conReintentoAuth(empresa, (token) => facturaApiService.emitirNotaCreditoSimple(token, payload));

  return {
    documentoId: data?.id ?? null,
    numero: data?.numero_nota_credito ?? null,
    numeroFormateado: data?.numeroNotaCreditoFormateada ?? null,
    cdc: data?.cdc ?? null,
    pdfNombre: data?.pdfNombre ?? null,
    estadoSifen: data?.estado_sifen ?? null,
    sifenEstadoMensaje: data?.sifen_estado_mensaje ?? null,
    linkQr: data?.linkqr ?? null,
  };
};

module.exports = { consultarTotalFactura, emitirNotaCredito };
