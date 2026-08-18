const logger = require('../utils/logger');
const facturaApiService = require('./facturaApi.service');
const { FacturaApiError, esErrorTransitorio } = require('./facturaApi.errors');
const { obtenerToken, autenticarYGuardar } = require('./facturacionAuth.service');

const safeError = (error) => ({ name: error?.name, message: error?.message, type: error?.type, status: error?.status });

// Se reconcilia por idExterno ante un error transitorio (timeout/red/5xx): la factura PUDO
// haberse creado igual pese al error (la respuesta se perdió, o falló después de crear/firmar).
// Un 400 (VALIDATION) o un 404 de configuración fallan ANTES de crear, así que no se reconcilia.
// emitirFactura hace UN intento; la cadencia de reintentos la maneja el barrido de fondo
// (emisionReintento.service.js), que en cada vuelta vuelve a llamar acá y reconcilia de nuevo.
const debeReconciliar = esErrorTransitorio;

// El idempotencyKey se envía como `idExterno`: el backend lo persiste en factura.id_externo
// y permite recuperar la factura por GET /factura/id-externo/:id para reconciliar reintentos.
const construirPayload = ({ cliente, condicionVenta, items, idExterno }) => ({
  // RUC -> CONTRIBUYENTE, cédula (CI) -> NO_CONTRIBUYENTE (ver contrato de POST /factura/simple).
  situacionTributaria: cliente.tipoDocumento === 'CI' ? 'NO_CONTRIBUYENTE' : 'CONTRIBUYENTE',
  personaDocumento: cliente.numeroDocumento,
  personaNombre: cliente.nombre,
  condicionVenta,
  idExterno,
  items: items.map(({ cantidad, precioUnitario, tasa, descripcion }) => ({
    cantidad,
    precioUnitario,
    tasa,
    descripcion,
  })),
});

// Normaliza la respuesta de POST /factura/simple al shape que consume el orquestador.
const mapearResultadoEmision = (data) => ({
  documentoId: data?.id ?? null,
  numero: data?.numero_factura ?? null,
  numeroFormateado: data?.numeroFacturaFormateada ?? null,
  cdc: data?.cdc ?? null,
  pdfNombre: data?.pdfNombre ?? null,
  clienteNombre: data?.clienteNombre ?? null,
  clienteDocumento: data?.clienteDocumento ?? null,
  estadoSifen: data?.estado_sifen ?? null,
  sifenEstadoMensaje: data?.sifen_estado_mensaje ?? null,
});

// La factura recuperada por GET /factura/id-externo trae otra forma que el POST: `numero_factura`
// ya viene formateado (string "001-002-0000007"), no expone pdfNombre/cliente sintetizados, y el
// cliente vive en cliente_empresa.cliente. Se normaliza al mismo shape (pdfNombre = <uuid>.pdf).
const mapearFacturaReconciliada = (data) => ({
  documentoId: data?.id ?? null,
  numero: null,
  numeroFormateado: typeof data?.numero_factura === 'string' ? data.numero_factura : null,
  cdc: data?.cdc ?? null,
  pdfNombre: data?.factura_uuid ? `${data.factura_uuid}.pdf` : null,
  clienteNombre: data?.cliente_empresa?.cliente?.razon_social ?? null,
  clienteDocumento: data?.cliente_empresa?.cliente?.ruc ?? null,
  estadoSifen: data?.estado_sifen ?? null,
  sifenEstadoMensaje: data?.sifen_estado_mensaje ?? null,
});

// Estados SIFEN en los que una factura existente NO se puede entregar como éxito (rechazada
// o cancelada): tampoco se debe reemitir (ya existe), así que se trata como indeterminado.
const ESTADOS_SIFEN_NO_ENTREGABLES = new Set(['RECHAZADO', 'CANCELADO']);

// Consulta por idExterno si ya existe la factura. Cuatro resultados posibles:
//  - ENCONTRADA: existe y es entregable -> se reutiliza, NO se reemite (evita duplicar).
//  - NO_EXISTE: el backend confirmó 404 -> es seguro postear.
//  - INDETERMINADO: la consulta falló, O existe pero SIFEN la rechazó/canceló -> no se puede
//    ni entregar ni reemitir sin arriesgar un duplicado; el caller pospone/agota el reintento.
const reconciliarPorIdExterno = async (token, idExterno) => {
  let data;
  try {
    data = await facturaApiService.buscarFacturaPorIdExterno(token, idExterno);
  } catch (error) {
    logger.warn('No se pudo reconciliar la emisión por idExterno', { ...safeError(error), idExterno });
    return { estado: 'INDETERMINADO' };
  }
  if (!data) return { estado: 'NO_EXISTE' };
  if (ESTADOS_SIFEN_NO_ENTREGABLES.has(data.estado_sifen)) {
    logger.warn('La factura del idExterno existe pero no es entregable', { idExterno, estadoSifen: data.estado_sifen });
    return { estado: 'INDETERMINADO' };
  }
  return { estado: 'ENCONTRADA', resultado: mapearFacturaReconciliada(data) };
};

/**
 * No descarga ni envía el PDF acá: solo emite. La factura queda FIRMADA (todavía
 * pendiente de aprobación asíncrona en SIFEN), pero el PDF ya está generado y en disco
 * cuando /factura/simple responde, así que el orquestador lo descarga y se lo envía al
 * cliente en el acto, sin esperar el estado final (ver botOrchestrator.service.js).
 * @param {{ empresa: object, cliente: {nombre: string, tipoDocumento: 'RUC'|'CI', numeroDocumento: string}, condicionVenta: 'CONTADO'|'CREDITO', items: Array<{descripcion: string, cantidad: number, precioUnitario: number, tasa: '0%'|'5%'|'10%'}>, totales: {subtotal: number, totalGeneral: number}, idempotencyKey: string }} params
 * @returns {Promise<{ documentoId: string, numero: string, numeroFormateado: string, cdc: string, pdfNombre: string, clienteNombre: string, clienteDocumento: string, estadoSifen: string, sifenEstadoMensaje: string }>}
 */
// Una emisión, con reautenticación única ante token cacheado inválido (revocado, reloj
// desincronizado, etc.): reautentica y reintenta una sola vez antes de propagar el error.
// Devuelve { data, token } — el token puede haber cambiado si hubo reautenticación, y el
// caller lo necesita para reconciliar con el token vigente.
const emitirConReautenticacion = async (empresa, token, payload, idempotencyKey) => {
  try {
    return { data: await facturaApiService.emitirFacturaSimple(token, payload), token };
  } catch (error) {
    if (!(error instanceof FacturaApiError) || error.type !== 'AUTH_FAILED') {
      throw error;
    }
    logger.info('Token de facturación rechazado, reautenticando', { empresaId: empresa.id, idempotencyKey });
    const tokenNuevo = await autenticarYGuardar(empresa);
    return { data: await facturaApiService.emitirFacturaSimple(tokenNuevo, payload), token: tokenNuevo };
  }
};

const emitirFactura = async ({ empresa, cliente, condicionVenta, items, idempotencyKey, reconciliarPrimero = false }) => {
  // El body lleva idExterno = idempotencyKey: mismo comprobante, mismo id_externo en cada
  // reintento de fondo, para que la reconciliación por idExterno funcione y no se duplique.
  const payload = construirPayload({ cliente, condicionVenta, items, idExterno: idempotencyKey });

  const token = await obtenerToken(empresa);

  // En un reintento de fondo, un intento previo pudo haber creado la factura (timeout tras
  // crearla): se consulta por idExterno ANTES de postear para no duplicarla. El backend NO
  // deduplica al crear, así que reconciliar-en-el-catch no alcanza: un POST nuevo duplicaría.
  // Solo se postea si se confirma que NO existe; si no se puede confirmar, se pospone el intento.
  if (reconciliarPrimero && idempotencyKey) {
    const previa = await reconciliarPorIdExterno(empresa.token || token, idempotencyKey);
    if (previa.estado === 'ENCONTRADA') return previa.resultado;
    if (previa.estado === 'INDETERMINADO') {
      throw new FacturaApiError('SERVER_ERROR', 'No se pudo verificar si la factura ya existía; se pospone el reintento');
    }
    // NO_EXISTE: es seguro postear.
  }

  let data;
  try {
    ({ data } = await emitirConReautenticacion(empresa, token, payload, idempotencyKey));
  } catch (error) {
    // Si la factura pudo haberse creado igual (timeout/red/5xx), reconciliar por idExterno
    // antes de propagar: así, si un intento previo ya la había emitido, se reutiliza en vez
    // de fallar (y el reintento de fondo no la duplica). Si la consulta no confirma que
    // exista, se propaga el error para que el caller agende/cuente el reintento.
    if (debeReconciliar(error)) {
      logger.warn('Emisión con error, reconciliando por idExterno', { empresaId: empresa.id, idempotencyKey, ...safeError(error) });
      // Se usa empresa.token porque emitirConReautenticacion pudo haberlo refrescado.
      const reconciliacion = await reconciliarPorIdExterno(empresa.token || token, idempotencyKey);
      if (reconciliacion.estado === 'ENCONTRADA') {
        logger.info('La factura ya existía para ese idExterno: se reutiliza sin reemitir', { empresaId: empresa.id, idempotencyKey });
        return reconciliacion.resultado;
      }
    }
    throw error;
  }

  if (!data?.pdfNombre) {
    logger.error('La API de facturación no devolvió pdfNombre', { empresaId: empresa.id, idempotencyKey });
  }

  return mapearResultadoEmision(data);
};

module.exports = { emitirFactura };
