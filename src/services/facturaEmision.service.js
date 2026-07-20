const logger = require('../utils/logger');
const facturaApiService = require('./facturaApi.service');
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
 * No descarga ni envía el PDF: la factura queda FIRMADA pero pendiente de aprobación
 * en SIFEN (asíncrono, vía cron del backend de facturación), así que todavía no hay
 * nada que mostrarle al cliente. El PDF se descarga y envía recién cuando se conoce el
 * estado final (ver documento.service.js).
 * @param {{ empresa: object, cliente: {nombre: string, tipoDocumento: 'RUC'|'CI', numeroDocumento: string}, condicionVenta: 'CONTADO'|'CREDITO', items: Array<{descripcion: string, cantidad: number, precioUnitario: number, tasa: '0%'|'5%'|'10%'}>, totales: {subtotal: number, totalGeneral: number}, idempotencyKey: string }} params
 * @returns {Promise<{ documentoId: string, numero: string, numeroFormateado: string, cdc: string, pdfNombre: string, clienteNombre: string, clienteDocumento: string, estadoSifen: string, sifenEstadoMensaje: string }>}
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

  if (!data?.pdfNombre) {
    logger.error('La API de facturación no devolvió pdfNombre', { empresaId: empresa.id, idempotencyKey });
  }

  return {
    documentoId: data?.id ?? null,
    numero: data?.numero_factura ?? null,
    numeroFormateado: data?.numeroFacturaFormateada ?? null,
    cdc: data?.cdc ?? null,
    pdfNombre: data?.pdfNombre ?? null,
    clienteNombre: data?.clienteNombre ?? null,
    clienteDocumento: data?.clienteDocumento ?? null,
    estadoSifen: data?.estado_sifen ?? null,
    sifenEstadoMensaje: data?.sifen_estado_mensaje ?? null,
  };
};

module.exports = { emitirFactura };
