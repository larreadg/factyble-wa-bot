const facturaApiService = require('./facturaApi.service');
const { obtenerToken, autenticarYGuardar } = require('./facturacionAuth.service');
const { FacturaApiError } = require('./facturaApi.errors');
const documentoService = require('./documento.service');

// Igual patrón que notaCreditoEmision.service.js: si el token cacheado es rechazado,
// reautentica una única vez y reintenta antes de propagar el error.
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

const mapearResultado = (data) => ({
  estadoSifen: data?.estado_sifen ?? null,
  mensajeRespuesta: data?.mensaje_respuesta ?? null,
  codigoRespuesta: data?.codigo_respuesta ?? null,
});

/**
 * @returns {Promise<{ estadoSifen: string, mensajeRespuesta: string, codigoRespuesta: string }>}
 */
const cancelarFactura = async (empresa, cdc) => {
  const data = await conReintentoAuth(empresa, (token) => facturaApiService.cancelarFacturaSimple(token, { cdc }));
  const resultado = mapearResultado(data);
  await documentoService.registrarCancelacion(cdc, { estadoSifen: resultado.estadoSifen, sifenEstadoMensaje: resultado.mensajeRespuesta });
  return resultado;
};

/**
 * @returns {Promise<{ estadoSifen: string, mensajeRespuesta: string, codigoRespuesta: string }>}
 */
const cancelarNotaCredito = async (empresa, cdc) => {
  const data = await conReintentoAuth(empresa, (token) => facturaApiService.cancelarNotaCreditoSimple(token, { cdc }));
  const resultado = mapearResultado(data);
  await documentoService.registrarCancelacion(cdc, { estadoSifen: resultado.estadoSifen, sifenEstadoMensaje: resultado.mensajeRespuesta });
  return resultado;
};

module.exports = { cancelarFactura, cancelarNotaCredito };
