const logger = require('../utils/logger');
const facturaApiService = require('./facturaApi.service');
const { obtenerToken, autenticarYGuardar } = require('./facturacionAuth.service');
const { FacturaApiError, esErrorTransitorio } = require('./facturaApi.errors');

const safeError = (error) => ({ name: error?.name, message: error?.message, type: error?.type, status: error?.status });

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
 * No descarga ni envía el PDF acá: solo emite. Igual que la factura, queda FIRMADA pero
 * el orquestador entrega el PDF en el acto (ver comentario en facturaEmision.service.js).
 * @param {{ empresa: object, cdc: string, items: Array<{descripcion: string, cantidad: number, precioUnitario: number, tasa: '0%'|'5%'|'10%'}> }} params
 * @returns {Promise<{ documentoId: string, numero: string, numeroFormateado: string, cdc: string, pdfNombre: string, clienteNombre: string, clienteDocumento: string, estadoSifen: string, sifenEstadoMensaje: string, linkQr: string }>}
 */
// Normaliza la respuesta de POST /nota-credito/simple al shape que consume el orquestador.
const mapearResultadoEmision = (data) => ({
  documentoId: data?.id ?? null,
  numero: data?.numero_nota_credito ?? null,
  numeroFormateado: data?.numeroNotaCreditoFormateada ?? null,
  cdc: data?.cdc ?? null,
  pdfNombre: data?.pdfNombre ?? null,
  clienteNombre: data?.clienteNombre ?? null,
  clienteDocumento: data?.clienteDocumento ?? null,
  estadoSifen: data?.estado_sifen ?? null,
  sifenEstadoMensaje: data?.sifen_estado_mensaje ?? null,
  linkQr: data?.linkqr ?? null,
});

// La NC recuperada por GET /nota-credito/id-externo trae otra forma (numero ya formateado,
// nota_credito_uuid en vez de pdfNombre). El cliente sale de la factura vinculada
// (factura.cliente_empresa.cliente) cuando el backend lo incluye; si no, queda null y el PDF
// igual lo lleva. Se normaliza al mismo shape (pdfNombre = <uuid>.pdf).
const mapearNotaCreditoReconciliada = (data) => ({
  documentoId: data?.id ?? null,
  numero: null,
  numeroFormateado: typeof data?.numero_nota_credito === 'string' ? data.numero_nota_credito : null,
  cdc: data?.cdc ?? null,
  pdfNombre: data?.nota_credito_uuid ? `${data.nota_credito_uuid}.pdf` : null,
  clienteNombre: data?.factura?.cliente_empresa?.cliente?.razon_social ?? null,
  clienteDocumento: data?.factura?.cliente_empresa?.cliente?.ruc ?? null,
  estadoSifen: data?.estado_sifen ?? null,
  sifenEstadoMensaje: data?.sifen_estado_mensaje ?? null,
  linkQr: data?.linkqr ?? null,
});

// Estados SIFEN en los que una NC existente NO es entregable (rechazada/cancelada): tampoco se
// reemite (ya existe), así que se trata como indeterminado.
const ESTADOS_SIFEN_NO_ENTREGABLES = new Set(['RECHAZADO', 'CANCELADO']);

// Igual criterio que facturaEmision.service.js. ENCONTRADA -> se reutiliza (no se duplica);
// NO_EXISTE -> es seguro postear; INDETERMINADO (consulta falló, o existe pero no es entregable)
// -> ni se entrega ni se reemite.
const reconciliarPorIdExterno = async (token, idExterno) => {
  let data;
  try {
    data = await facturaApiService.buscarNotaCreditoPorIdExterno(token, idExterno);
  } catch (error) {
    logger.warn('No se pudo reconciliar la NC por idExterno', { ...safeError(error), idExterno });
    return { estado: 'INDETERMINADO' };
  }
  if (!data) return { estado: 'NO_EXISTE' };
  if (ESTADOS_SIFEN_NO_ENTREGABLES.has(data.estado_sifen)) {
    logger.warn('La NC del idExterno existe pero no es entregable', { idExterno, estadoSifen: data.estado_sifen });
    return { estado: 'INDETERMINADO' };
  }
  return { estado: 'ENCONTRADA', resultado: mapearNotaCreditoReconciliada(data) };
};

const emitirNotaCredito = async ({ empresa, cdc, items, idempotencyKey, reconciliarPrimero = false }) => {
  // El idExterno (idempotencyKey) se persiste en nota_credito.id_externo y permite recuperar la
  // NC por GET /nota-credito/id-externo/:id para reconciliar reintentos sin duplicar.
  const payload = {
    cdc,
    idExterno: idempotencyKey,
    items: items.map(({ cantidad, precioUnitario, descripcion, tasa }) => ({ cantidad, precioUnitario, descripcion, tasa })),
  };

  // En un reintento de fondo, un intento previo pudo haber creado la NC: se consulta por
  // idExterno ANTES de postear para no duplicarla (el backend no deduplica al crear). Solo se
  // postea si se confirma que NO existe; si no se puede confirmar, se pospone el reintento.
  if (reconciliarPrimero && idempotencyKey) {
    const token = await obtenerToken(empresa);
    const previa = await reconciliarPorIdExterno(empresa.token || token, idempotencyKey);
    if (previa.estado === 'ENCONTRADA') return previa.resultado;
    if (previa.estado === 'INDETERMINADO') {
      throw new FacturaApiError('SERVER_ERROR', 'No se pudo verificar si la NC ya existía; se pospone el reintento');
    }
  }

  try {
    const data = await conReintentoAuth(empresa, (token) => facturaApiService.emitirNotaCreditoSimple(token, payload));
    return mapearResultadoEmision(data);
  } catch (error) {
    // Reconciliación en el catch: reutiliza el token que conReintentoAuth ya dejó en
    // empresa.token (no se vuelve a llamar obtenerToken acá, que podría tirar y enmascarar
    // el error transitorio original).
    if (esErrorTransitorio(error) && idempotencyKey && empresa.token) {
      logger.warn('Emisión de NC con error, reconciliando por idExterno', { empresaId: empresa.id, idempotencyKey, ...safeError(error) });
      const reconciliacion = await reconciliarPorIdExterno(empresa.token, idempotencyKey);
      if (reconciliacion.estado === 'ENCONTRADA') {
        logger.info('La NC ya existía para ese idExterno: se reutiliza sin reemitir', { empresaId: empresa.id, idempotencyKey });
        return reconciliacion.resultado;
      }
    }
    throw error;
  }
};

module.exports = { consultarTotalFactura, emitirNotaCredito };
