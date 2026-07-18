const logger = require('../utils/logger');
const { normalizarTelefono, esSaludoPuro } = require('../utils/texto');
const { construirMensajeCamposFaltantes, construirResumenConfirmacion } = require('../utils/facturaPresentacion');
const {
  construirMensajeTotalEncontrado,
  construirMensajeMontoExcedeTotal,
  construirResumenConfirmacionNC,
} = require('../utils/notaCreditoPresentacion');
const {
  construirResumenConfirmacionCancelacion,
  construirMensajeSugerirTipoAlternativo,
  construirMensajeCancelacionExitosa,
  construirMensajeRechazoSifen,
  construirMensajeNotaCreditoVinculadas,
  construirMensajeEstadoNoAprobado,
} = require('../utils/cancelacionPresentacion');
const { extraerCdc } = require('../utils/cdc');
const {
  ESTADOS_SESION,
  ESTADOS_TERMINALES,
  MENSAJES,
  MENSAJE_BIENVENIDA,
  MENSAJE_ANTIGUEDAD_MAXIMA_MS,
  OPERACIONES,
  MENU_IDS,
} = require('../utils/constants');

const contactoService = require('./contacto.service');
const conversacionService = require('./conversacion.service');
const sesionConversacionalService = require('./sesionConversacional.service');
const mensajeService = require('./mensaje.service');
const whatsappService = require('./whatsapp.service');
const facturaParserService = require('./facturaParser.service');
const facturaBorradorService = require('./facturaBorrador.service');
const facturaEmisionService = require('./facturaEmision.service');
const notaCreditoParserService = require('./notaCreditoParser.service');
const notaCreditoBorradorService = require('./notaCreditoBorrador.service');
const notaCreditoEmisionService = require('./notaCreditoEmision.service');
const cancelacionParserService = require('./cancelacionParser.service');
const cancelacionDocumentoService = require('./cancelacionDocumento.service');
const documentoService = require('./documento.service');
const transcripcionService = require('./transcripcion.service');
const { OpenAIServiceError } = require('./openai.errors');
const { FacturaApiError } = require('./facturaApi.errors');

// Estados desde los que se puede pasar a CAPTURANDO_DATOS/ESPERANDO_CONFIRMACION/
// PROCESANDO/CANCELADA: cualquier estado no terminal y no ya-en-procesamiento.
const ESTADOS_ACTIVOS = [ESTADOS_SESION.INICIO, ESTADOS_SESION.CAPTURANDO_DATOS, ESTADOS_SESION.ESPERANDO_CONFIRMACION];

const TIPO_MENSAJE_POR_WHATSAPP = {
  text: 'TEXTO',
  audio: 'AUDIO',
  image: 'IMAGEN',
  document: 'DOCUMENTO',
};

const ESTADO_WHATSAPP_A_ESTADO_MENSAJE = {
  sent: 'ENVIADO',
  delivered: 'ENTREGADO',
  read: 'LEIDO',
  failed: 'FALLIDO',
};

// Evita registrar el objeto de error completo (puede incluir headers/config con datos
// sensibles); solo se conservan nombre y mensaje para diagnóstico.
const safeError = (error) => ({ name: error?.name, message: error?.message, type: error?.type });

const mapOpenAIErrorAMensaje = (error) => {
  if (error instanceof OpenAIServiceError) {
    if (['TIMEOUT', 'RATE_LIMIT', 'CONNECTION', 'AUTH', 'UNKNOWN'].includes(error.type)) {
      return MENSAJES.OPENAI_NO_DISPONIBLE;
    }
    return MENSAJES.NO_SE_PUDO_INTERPRETAR;
  }
  return MENSAJES.OPENAI_NO_DISPONIBLE;
};

const mapTranscripcionErrorAMensaje = (error) => {
  if (error instanceof OpenAIServiceError) {
    if (['TIMEOUT', 'RATE_LIMIT', 'CONNECTION', 'AUTH', 'UNKNOWN'].includes(error.type)) {
      return MENSAJES.OPENAI_NO_DISPONIBLE;
    }
    return MENSAJES.AUDIO_NO_TRANSCRIBIBLE;
  }
  return MENSAJES.OPENAI_NO_DISPONIBLE;
};

const responderYRegistrar = async (conversacion, contacto, texto) => {
  let estado = 'PENDIENTE';
  let whatsappMensajeId = null;

  try {
    const resultado = await whatsappService.sendTextMessage(contacto.numeroTelefono, texto);
    whatsappMensajeId = resultado?.messages?.[0]?.id || null;
    estado = 'ENVIADO';
  } catch (error) {
    logger.error('Error enviando mensaje saliente de WhatsApp', safeError(error));
    estado = 'FALLIDO';
  }

  await mensajeService.registrarSaliente({
    conversacionId: conversacion.id,
    tipo: 'TEXTO',
    contenidoTexto: texto,
    estado,
    whatsappMensajeId,
  });
};

const enviarMenuPrincipalYRegistrar = async (conversacion, contacto) => {
  let estado = 'PENDIENTE';
  let whatsappMensajeId = null;

  try {
    const resultado = await whatsappService.enviarMenuPrincipal(contacto.numeroTelefono);
    whatsappMensajeId = resultado?.messages?.[0]?.id || null;
    estado = 'ENVIADO';
  } catch (error) {
    logger.error('Error enviando menú principal de WhatsApp', safeError(error));
    estado = 'FALLIDO';
  }

  await mensajeService.registrarSaliente({
    conversacionId: conversacion.id,
    tipo: 'TEXTO',
    contenidoTexto: MENSAJES.MENU_PRINCIPAL_LOG,
    estado,
    whatsappMensajeId,
  });
};

// Palabras que indican que el usuario quiere anular por completo un documento ya
// emitido (factura o NC), a diferencia de emitir una nota de crédito (acreditar un
// monto contra una factura que sigue vigente). PATRON_PARCIAL detecta cuando el
// usuario en realidad quiere una devolución/anulación parcial: eso no es este flujo, y
// ante esa ambigüedad hay que preguntar antes de avanzar (ver spec del flujo).
const PATRON_CANCELAR_DOCUMENTO = /\b(cancelar|cancel[aá]|cancelame|anular|anul[aá]|anulame)\b/i;
const PATRON_DOCUMENTO_EMITIDO = /\b(factura|nota\s*de\s*cr[eé]dito|\bnc\b|documento|cdc)\b/i;
const PATRON_PARCIAL = /\bparcial(mente)?\b|\balgunos?\s+(productos|items|ítems|art[ií]culos)\b/i;

const detectarIntentoCancelacionDocumento = (texto) => {
  if (!texto || !PATRON_CANCELAR_DOCUMENTO.test(texto)) return 'NINGUNO';
  if (PATRON_PARCIAL.test(texto)) return 'AMBIGUO';

  const { cdc, candidatoInvalido } = extraerCdc(texto);
  if (PATRON_DOCUMENTO_EMITIDO.test(texto) || cdc || candidatoInvalido) return 'CANCELACION';

  return 'NINGUNO';
};

// Best-effort: para cuando esto se llama, el documento ya fue emitido y firmado en
// SIFEN (irreversible desde acá), así que una falla al persistir la fila local (ej.
// reintento con el mismo cdc por idempotencyKey, o un error transitorio de DB) no debe
// impedir que la sesión llegue a COMPLETADA ni que se avise al cliente.
const registrarDocumentoEmitido = async (datos) => {
  try {
    await documentoService.registrarEmision(datos);
  } catch (error) {
    logger.error('Error registrando el documento emitido', { ...safeError(error), cdc: datos.cdc, tipo: datos.tipo });
  }
};

const construirMensajeDatosRechazados = (detalle) =>
  `No pudimos emitir la factura: la API de facturación rechazó algunos datos${detalle ? ` (${detalle})` : ''}. Revisá los datos, indicá la corrección que haga falta y volvé a confirmar.`;

const cancelar = async ({ contacto, conversacion, sesion }) => {
  const actualizada = await sesionConversacionalService.transicionar(sesion.id, ESTADOS_ACTIVOS, ESTADOS_SESION.CANCELADA, sesion.datosTemporales);

  if (!actualizada) return;

  await responderYRegistrar(conversacion, contacto, MENSAJES.CANCELACION);
};

const confirmarYEmitir = async ({ contacto, conversacion, sesion, borrador }) => {
  const idempotencyKey = `factyble:whatsapp:${conversacion.id}:${sesion.id}:${borrador.version}`;
  const datosConKey = { ...borrador, idempotencyKey };

  const enProcesamiento = await sesionConversacionalService.transicionar(sesion.id, ESTADOS_ACTIVOS, ESTADOS_SESION.PROCESANDO, datosConKey);

  if (!enProcesamiento) {
    // Ya fue confirmada por un mensaje concurrente: no se dispara una segunda emisión.
    await responderYRegistrar(conversacion, contacto, MENSAJES.YA_PROCESANDO);
    return;
  }

  await responderYRegistrar(conversacion, contacto, MENSAJES.PROCESANDO_FACTURA);

  let resultado;
  try {
    resultado = await facturaEmisionService.emitirFactura({
      empresa: contacto.empresa,
      cliente: datosConKey.cliente,
      condicionVenta: datosConKey.condicionVenta,
      items: datosConKey.items,
      totales: datosConKey.totales,
      idempotencyKey,
    });
  } catch (error) {
    if (error instanceof FacturaApiError && error.type === 'VALIDATION') {
      // Dato rechazado por la API de facturación (ej. RUC inexistente para SIFEN): es
      // corregible por el usuario, así que no se descarta el borrador ni se termina la
      // sesión — se vuelve a ESPERANDO_CONFIRMACION para que pueda corregir y reintentar.
      logger.error('La API de facturación rechazó los datos', safeError(error));
      await sesionConversacionalService.transicionar(sesion.id, [ESTADOS_SESION.PROCESANDO], ESTADOS_SESION.ESPERANDO_CONFIRMACION, borrador);
      await responderYRegistrar(conversacion, contacto, construirMensajeDatosRechazados(error.message));
      return;
    }

    logger.error('Error al emitir factura', safeError(error));
    await sesionConversacionalService.transicionar(sesion.id, [ESTADOS_SESION.PROCESANDO], ESTADOS_SESION.ERROR, datosConKey);
    await responderYRegistrar(conversacion, contacto, MENSAJES.ERROR_EMISION);
    return;
  }

  await registrarDocumentoEmitido({
    empresaId: contacto.empresa.id,
    numeroTelefono: contacto.numeroTelefono,
    tipo: 'FACTURA',
    cdc: resultado.cdc,
    pdfNombre: resultado.pdfNombre,
    numeroDocumentoFormateado: resultado.numeroFormateado,
    estadoSifen: resultado.estadoSifen,
    sifenEstadoMensaje: resultado.sifenEstadoMensaje,
  });

  const datosCompletados = {
    ...datosConKey,
    resultadoEmision: {
      documentoId: resultado.documentoId ?? null,
      numero: resultado.numero ?? null,
      cdc: resultado.cdc ?? null,
    },
  };

  await sesionConversacionalService.transicionar(sesion.id, [ESTADOS_SESION.PROCESANDO], ESTADOS_SESION.COMPLETADA, datosCompletados);
  await responderYRegistrar(conversacion, contacto, MENSAJES.FACTURA_PENDIENTE_APROBACION);
};

// ---- Flujo de cancelación de documentos (factura o nota de crédito ya emitidas) ----

const cancelacionBorradorVacio = () => ({
  tipoDocumento: null,
  cdc: null,
  cdcInvalido: false,
  // true mientras se le pregunta al usuario si el CDC puede ser del tipo alternativo
  // (ver Paso 5 / manejo del 404 del spec).
  sugerirTipoAlternativo: false,
  // Evita ofrecer el tipo alternativo más de una vez para el mismo CDC: si el segundo
  // intento también da 404, se aborta el flujo en vez de volver a preguntar.
  intentoAlternativoUsado: false,
});

const mensajeRecordatorioCancelacion = (borrador) => {
  if (borrador.sugerirTipoAlternativo) return construirMensajeSugerirTipoAlternativo(borrador);
  if (!borrador.tipoDocumento) return MENSAJES.CANC_PEDIR_TIPO;
  if (!borrador.cdc) return borrador.cdcInvalido ? MENSAJES.CANC_CDC_INVALIDO : MENSAJES.CANC_PEDIR_CDC;
  return construirResumenConfirmacionCancelacion(borrador);
};

const abortarCancelacion = async ({ contacto, conversacion, sesion }) => {
  const actualizada = await sesionConversacionalService.transicionar(sesion.id, ESTADOS_ACTIVOS, ESTADOS_SESION.CANCELADA, sesion.datosTemporales);

  if (!actualizada) return;

  await responderYRegistrar(conversacion, contacto, MENSAJES.CANC_CANCELACION);
};

// Traduce los errores de POST /factura|nota-credito/simple/cancelar (ver tabla del
// spec) a un mensaje para el usuario y a qué debe volver la sesión. El 404 (CDC no
// encontrado, posible tipo equivocado) se maneja aparte, en confirmarYCancelarDocumento,
// porque dispara un sub-flujo propio (sugerir el tipo alternativo) en vez de un mensaje
// simple.
const mapCancelacionError = (error, borrador) => {
  if (error instanceof FacturaApiError && error.type === 'VALIDATION') {
    const msg = error.message;

    if (mensajeContiene(msg, 'cancelad')) {
      return { mensaje: MENSAJES.CANC_YA_CANCELADO, resetCdc: false, terminarOk: true };
    }
    if (borrador.tipoDocumento === 'FACTURA' && mensajeContiene(msg, 'nota') && mensajeContiene(msg, 'aprobada')) {
      return { mensaje: construirMensajeNotaCreditoVinculadas(msg), resetCdc: false, terminarOk: false };
    }
    if (mensajeContiene(msg, 'aprobado')) {
      return { mensaje: construirMensajeEstadoNoAprobado(msg), resetCdc: false, terminarOk: false };
    }
    if (mensajeContiene(msg, 'caja')) {
      return { mensaje: MENSAJES.CANC_SIN_CAJA, resetCdc: false, terminarOk: false };
    }
    return { mensaje: MENSAJES.CANC_CDC_FORMATO_INVALIDO, resetCdc: true, terminarOk: false };
  }

  return { mensaje: MENSAJES.CANC_ERROR, resetCdc: false, terminarOk: false };
};

const confirmarYCancelarDocumento = async ({ contacto, conversacion, sesion, borrador }) => {
  const enProcesamiento = await sesionConversacionalService.transicionar(sesion.id, ESTADOS_ACTIVOS, ESTADOS_SESION.PROCESANDO, borrador);

  if (!enProcesamiento) {
    // Ya fue confirmada por un mensaje concurrente: no se dispara una segunda cancelación.
    await responderYRegistrar(conversacion, contacto, MENSAJES.CANC_YA_PROCESANDO);
    return;
  }

  await responderYRegistrar(conversacion, contacto, MENSAJES.CANC_PROCESANDO);

  let resultado;
  try {
    resultado =
      borrador.tipoDocumento === 'FACTURA'
        ? await cancelacionDocumentoService.cancelarFactura(contacto.empresa, borrador.cdc)
        : await cancelacionDocumentoService.cancelarNotaCredito(contacto.empresa, borrador.cdc);
  } catch (error) {
    logger.error('Error al cancelar documento', safeError(error));

    if (error instanceof FacturaApiError && error.type === 'NOT_FOUND') {
      if (borrador.intentoAlternativoUsado) {
        await sesionConversacionalService.transicionar(sesion.id, [ESTADOS_SESION.PROCESANDO], ESTADOS_SESION.CANCELADA, borrador);
        await responderYRegistrar(conversacion, contacto, MENSAJES.CANC_CDC_NO_CORRESPONDE);
        return;
      }

      const borradorConSugerencia = { ...borrador, sugerirTipoAlternativo: true, intentoAlternativoUsado: true };
      await sesionConversacionalService.transicionar(sesion.id, [ESTADOS_SESION.PROCESANDO], ESTADOS_SESION.ESPERANDO_CONFIRMACION, borradorConSugerencia);
      await responderYRegistrar(conversacion, contacto, construirMensajeSugerirTipoAlternativo(borrador));
      return;
    }

    const { mensaje, resetCdc, terminarOk } = mapCancelacionError(error, borrador);

    if (resetCdc) {
      const borradorSinCdc = { ...borrador, cdc: null, cdcInvalido: false };
      await sesionConversacionalService.transicionar(sesion.id, [ESTADOS_SESION.PROCESANDO], ESTADOS_SESION.CAPTURANDO_DATOS, borradorSinCdc);
    } else if (terminarOk) {
      await sesionConversacionalService.transicionar(sesion.id, [ESTADOS_SESION.PROCESANDO], ESTADOS_SESION.COMPLETADA, borrador);
    } else {
      await sesionConversacionalService.transicionar(sesion.id, [ESTADOS_SESION.PROCESANDO], ESTADOS_SESION.ERROR, borrador);
    }

    await responderYRegistrar(conversacion, contacto, mensaje);
    return;
  }

  const datosCompletados = { ...borrador, resultadoCancelacion: resultado };

  // Regla crítica: un HTTP 200 no significa cancelado. Solo se informa éxito si SIFEN
  // efectivamente aprobó el evento de cancelación.
  if (resultado.estadoSifen === 'CANCELADO') {
    await sesionConversacionalService.transicionar(sesion.id, [ESTADOS_SESION.PROCESANDO], ESTADOS_SESION.COMPLETADA, datosCompletados);
    await responderYRegistrar(conversacion, contacto, construirMensajeCancelacionExitosa({ cdc: borrador.cdc, estadoSifen: resultado.estadoSifen }));
    return;
  }

  await sesionConversacionalService.transicionar(sesion.id, [ESTADOS_SESION.PROCESANDO], ESTADOS_SESION.ERROR, datosCompletados);
  await responderYRegistrar(conversacion, contacto, construirMensajeRechazoSifen(resultado));
};

// Único punto de entrada para cualquier mensaje de texto mientras operacionActiva ===
// CANCELAR_DOCUMENTO. Paso 1 (tipo de documento) y Paso 2 (CDC) son iguales en
// espíritu al flujo de NC; lo distinto acá es el Paso 3: la confirmación SIEMPRE
// requiere un mensaje separado del que trajo el tipo+CDC, incluso si la IA clasifica
// accion=CONFIRMAR en ese mismo mensaje (regla explícita del spec: la cancelación es
// irreversible). Por eso solo se llama a confirmarYCancelarDocumento cuando la sesión
// YA estaba en ESPERANDO_CONFIRMACION antes de este mensaje y el mensaje no trajo tipo
// ni CDC nuevos.
const procesarCancelacion = async ({ contacto, conversacion, sesion, texto }) => {
  const borradorActual = sesion.datosTemporales;

  if (esSaludoPuro(texto)) {
    await responderYRegistrar(conversacion, contacto, mensajeRecordatorioCancelacion(borradorActual));
    return;
  }

  const enEsperaDeConfirmacion = sesion.estado === ESTADOS_SESION.ESPERANDO_CONFIRMACION;

  let salidaParser;
  try {
    salidaParser = await cancelacionParserService.interpretar({
      mensajeUsuario: texto,
      tipoDocumentoActual: borradorActual.tipoDocumento,
      enEsperaDeConfirmacion,
    });
  } catch (error) {
    logger.error('Error interpretando mensaje de cancelación de documento con OpenAI', safeError(error));
    await responderYRegistrar(conversacion, contacto, mapOpenAIErrorAMensaje(error));
    return;
  }

  const { accion, tipoDocumento: tipoDetectado } = salidaParser;

  if (accion === 'SALUDO' || accion === 'SOLICITAR_ACLARACION') {
    await responderYRegistrar(conversacion, contacto, mensajeRecordatorioCancelacion(borradorActual));
    return;
  }

  if (accion === 'FUERA_DE_ALCANCE') {
    await responderYRegistrar(conversacion, contacto, MENSAJES.FUERA_DE_ALCANCE);
    return;
  }

  if (accion === 'CANCELAR') {
    await abortarCancelacion({ contacto, conversacion, sesion });
    return;
  }

  // El usuario aceptó probar con el tipo alternativo tras un 404: se cambia el tipo y
  // se vuelve a mostrar el resumen de confirmación (Paso 3) en vez de llamar directo a
  // la API con el nuevo tipo — nunca se reintenta sin una confirmación aparte.
  if (borradorActual.sugerirTipoAlternativo && accion === 'CONFIRMAR') {
    const tipoAlternativo = borradorActual.tipoDocumento === 'FACTURA' ? 'NOTA_CREDITO' : 'FACTURA';
    const borradorFlip = { ...borradorActual, tipoDocumento: tipoAlternativo, cdcInvalido: false, sugerirTipoAlternativo: false };
    const actualizada = await sesionConversacionalService.transicionar(sesion.id, ESTADOS_ACTIVOS, ESTADOS_SESION.ESPERANDO_CONFIRMACION, borradorFlip);
    if (!actualizada) return;
    await responderYRegistrar(conversacion, contacto, construirResumenConfirmacionCancelacion(borradorFlip));
    return;
  }

  // El CDC se extrae de forma determinística del texto crudo (igual que en NC): un LLM
  // no reproduce con fiabilidad una cadena de 44 dígitos.
  const { cdc: cdcExtraido, candidatoInvalido } = extraerCdc(texto);

  const borrador = {
    ...borradorActual,
    tipoDocumento: tipoDetectado || borradorActual.tipoDocumento,
    cdc: cdcExtraido || borradorActual.cdc,
    cdcInvalido: cdcExtraido ? false : Boolean(candidatoInvalido) || Boolean(borradorActual.cdcInvalido),
    sugerirTipoAlternativo: false,
  };

  // Paso 1: tipo de documento.
  if (!borrador.tipoDocumento) {
    const actualizada = await sesionConversacionalService.transicionar(sesion.id, ESTADOS_ACTIVOS, ESTADOS_SESION.CAPTURANDO_DATOS, borrador);
    if (!actualizada) return;
    await responderYRegistrar(conversacion, contacto, MENSAJES.CANC_PEDIR_TIPO);
    return;
  }

  // Paso 2: CDC.
  if (!borrador.cdc) {
    const actualizada = await sesionConversacionalService.transicionar(sesion.id, ESTADOS_ACTIVOS, ESTADOS_SESION.CAPTURANDO_DATOS, borrador);
    if (!actualizada) return;
    await responderYRegistrar(conversacion, contacto, borrador.cdcInvalido ? MENSAJES.CANC_CDC_INVALIDO : MENSAJES.CANC_PEDIR_CDC);
    return;
  }

  // Paso 3: confirmación explícita, siempre en un turno aparte del que trajo tipo+CDC
  // (ver comentario de la función).
  const traeDatosNuevos = Boolean(cdcExtraido) || Boolean(tipoDetectado);

  if (accion === 'CONFIRMAR' && enEsperaDeConfirmacion && !traeDatosNuevos) {
    await confirmarYCancelarDocumento({ contacto, conversacion, sesion, borrador });
    return;
  }

  const actualizada = await sesionConversacionalService.transicionar(sesion.id, ESTADOS_ACTIVOS, ESTADOS_SESION.ESPERANDO_CONFIRMACION, borrador);
  if (!actualizada) return;
  await responderYRegistrar(conversacion, contacto, construirResumenConfirmacionCancelacion(borrador));
};

// Único punto de entrada para cualquier mensaje de texto en un estado activo (INICIO/
// CAPTURANDO_DATOS/ESPERANDO_CONFIRMACION). Le delega a la IA la clasificación de
// confirmación/cancelación/corrección/fuera de alcance (en vez de heurísticas locales
// por palabra clave, que fallaban ante variantes de fraseo) — el saludo puro es la
// excepción: se resuelve localmente con esSaludoPuro (tolerante a variantes tipo "hola
// hola!!") para no gastar una llamada a OpenAI en el caso más frecuente y barato de
// clasificar. accion=SALUDO en la respuesta de la IA queda como red de contención por
// si algún saludo se escapa de la detección local.
// `esContextoInicial` es true cuando, al llegar este mensaje, operacionActiva todavía
// era null (regla C del router): además del flujo normal, en ese caso SALUDO/
// FUERA_DE_ALCANCE/CANCELAR/CONFIRMAR-sin-datos se resuelven mostrando el menú
// principal en vez de los mensajes de texto habituales. Cuando es false (operacionActiva
// ya es EMITIR_FACTURA, explícita o implícita), el comportamiento es exactamente el de
// siempre: ninguna de las ramas nuevas se activa.
const procesarConParser = async ({ contacto, conversacion, sesion, texto, esContextoInicial }) => {
  if (esSaludoPuro(texto)) {
    if (esContextoInicial) {
      await enviarMenuPrincipalYRegistrar(conversacion, contacto);
    } else {
      await responderYRegistrar(conversacion, contacto, MENSAJE_BIENVENIDA);
    }
    return;
  }

  // Solo se evalúa en contexto inicial (operacionActiva aún null): ahí "cancelar" no
  // puede referirse a abortar un borrador de factura en curso, porque todavía no existe
  // ninguno, así que no hay ambigüedad con el accion=CANCELAR de facturaParser.
  if (esContextoInicial) {
    const intento = detectarIntentoCancelacionDocumento(texto);

    if (intento === 'AMBIGUO') {
      await responderYRegistrar(
        conversacion,
        contacto,
        '¿Querés anular completamente el documento (pierde validez fiscal ante SIFEN) o generar una nota de crédito parcial sobre una factura que sigue vigente? Contame cuál de las dos necesitás.',
      );
      return;
    }

    if (intento === 'CANCELACION') {
      const borradorInicial = cancelacionBorradorVacio();
      await sesionConversacionalService.iniciarOperacion(sesion.id, OPERACIONES.CANCELAR_DOCUMENTO, borradorInicial);
      await procesarCancelacion({
        contacto,
        conversacion,
        sesion: { ...sesion, operacionActiva: OPERACIONES.CANCELAR_DOCUMENTO, estado: ESTADOS_SESION.INICIO, datosTemporales: borradorInicial },
        texto,
      });
      return;
    }
  }

  let salidaParser;
  try {
    salidaParser = await facturaParserService.interpretar({
      mensajeUsuario: texto,
      borradorActual: facturaBorradorService.sanitizarBorradorParaIA(sesion.datosTemporales),
    });
  } catch (error) {
    logger.error('Error interpretando mensaje con OpenAI', safeError(error));
    await responderYRegistrar(conversacion, contacto, mapOpenAIErrorAMensaje(error));
    return;
  }

  const { accion } = salidaParser;

  if (accion === 'SALUDO') {
    if (esContextoInicial) {
      await enviarMenuPrincipalYRegistrar(conversacion, contacto);
    } else {
      await responderYRegistrar(conversacion, contacto, MENSAJE_BIENVENIDA);
    }
    return;
  }

  if (accion === 'FUERA_DE_ALCANCE') {
    await responderYRegistrar(conversacion, contacto, MENSAJES.FUERA_DE_ALCANCE);
    if (esContextoInicial) {
      await enviarMenuPrincipalYRegistrar(conversacion, contacto);
    }
    return;
  }

  if (accion === 'CANCELAR') {
    if (esContextoInicial) {
      // En contexto inicial operacionActiva y datosTemporales siempre se resetean
      // juntos (ver resetSesion), así que acá nunca hay un borrador real que cancelar.
      await enviarMenuPrincipalYRegistrar(conversacion, contacto);
      return;
    }
    await cancelar({ contacto, conversacion, sesion });
    return;
  }

  const borradorAnterior = facturaBorradorService.migrarBorradorLegado(sesion.datosTemporales);
  const borrador = facturaBorradorService.construirBorrador(salidaParser.factura, borradorAnterior, salidaParser.advertencias);
  const borradorTieneAlgo = Boolean(borrador.cliente.nombre || borrador.cliente.numeroDocumento || borrador.items.length);

  if (esContextoInicial && accion === 'CONFIRMAR' && !borradorTieneAlgo) {
    // "Confirmá"/"dale" sin ningún dato de factura en este mensaje ni en el borrador
    // previo: no hay nada que confirmar.
    await enviarMenuPrincipalYRegistrar(conversacion, contacto);
    return;
  }

  if (esContextoInicial) {
    // Caso estrella: el usuario mandó datos de factura directo, sin pasar por el menú.
    // Se fija operacionActiva implícitamente y el resto del flujo continúa sin fricción.
    await sesionConversacionalService.setOperacionActiva(sesion.id, OPERACIONES.EMITIR_FACTURA);
  }

  // Si ya había algo armado y el borrador reconstruido queda idéntico tras un mensaje
  // que la IA no clasificó como CONFIRMAR, lo más probable es que no haya entendido la
  // corrección: mejor avisar que reenviar en silencio la misma confirmación/resumen.
  const borradorAnteriorTeniaAlgo = Boolean(
    borradorAnterior?.cliente?.nombre || borradorAnterior?.cliente?.numeroDocumento || borradorAnterior?.items?.length,
  );
  const esCorreccionNoEntendida =
    borradorAnteriorTeniaAlgo && accion !== 'CONFIRMAR' && facturaBorradorService.sonEquivalentes(borrador, borradorAnterior);

  if (esCorreccionNoEntendida) {
    await responderYRegistrar(conversacion, contacto, MENSAJES.CORRECCION_NO_ENTENDIDA);
    return;
  }

  if (borrador.camposFaltantes.length > 0) {
    const actualizada = await sesionConversacionalService.transicionar(sesion.id, ESTADOS_ACTIVOS, ESTADOS_SESION.CAPTURANDO_DATOS, borrador);

    if (!actualizada) return;

    const mensaje = construirMensajeCamposFaltantes(borrador.camposFaltantes, {
      intentoConfirmar: accion === 'CONFIRMAR',
      advertencias: borrador.advertencias,
    });
    await responderYRegistrar(conversacion, contacto, mensaje);
    return;
  }

  if (accion === 'CONFIRMAR') {
    await confirmarYEmitir({ contacto, conversacion, sesion, borrador });
    return;
  }

  const actualizada = await sesionConversacionalService.transicionar(sesion.id, ESTADOS_ACTIVOS, ESTADOS_SESION.ESPERANDO_CONFIRMACION, borrador);

  if (!actualizada) return;

  await responderYRegistrar(conversacion, contacto, construirResumenConfirmacion(borrador));
};

// Qué recordarle al usuario cuando no hay nada nuevo que procesar (saludo, o accion=
// SALUDO como red de contención): depende de en qué paso del flujo de NC está el
// borrador, en vez de un mensaje fijo.
const mensajeRecordatorioNC = (borrador) => {
  if (!borrador.cdc) return MENSAJES.NC_PEDIR_CDC;
  if (borrador.totalFactura == null || borrador.items.length === 0) return MENSAJES.NC_PEDIR_ITEMS;
  if (borrador.camposFaltantes.length > 0) {
    return construirMensajeCamposFaltantes(borrador.camposFaltantes, { advertencias: borrador.advertencias });
  }
  return construirResumenConfirmacionNC(borrador);
};

const cancelarNotaCredito = async ({ contacto, conversacion, sesion }) => {
  const actualizada = await sesionConversacionalService.transicionar(sesion.id, ESTADOS_ACTIVOS, ESTADOS_SESION.CANCELADA, sesion.datosTemporales);

  if (!actualizada) return;

  await responderYRegistrar(conversacion, contacto, MENSAJES.NC_CANCELACION);
};

const mensajeContiene = (mensaje, ...fragmentos) => {
  const normalizado = (mensaje || '').toLowerCase();
  return fragmentos.some((fragmento) => normalizado.includes(fragmento));
};

// Traduce los errores documentados de POST /nota-credito/simple (ver tabla del spec) a
// un mensaje para el usuario y a qué debe volver la sesión: resetCdc (el CDC no sirve,
// hay que pedir uno distinto), volverAConfirmacion (el borrador sigue siendo válido,
// el usuario puede corregir y reintentar) o, si ninguno aplica, ERROR terminal.
const mapNotaCreditoEmisionError = (error) => {
  if (!(error instanceof FacturaApiError)) {
    return { mensaje: MENSAJES.NC_ERROR_EMISION, resetCdc: false, volverAConfirmacion: false };
  }

  const msg = error.message;

  if (error.type === 'NOT_FOUND' && mensajeContiene(msg, 'establecimiento', 'caja')) {
    return { mensaje: MENSAJES.NC_CONFIG_FALTANTE, resetCdc: false, volverAConfirmacion: true };
  }
  if (error.type === 'NOT_FOUND') {
    return { mensaje: MENSAJES.NC_CDC_NO_ENCONTRADO, resetCdc: true, volverAConfirmacion: false };
  }
  if (error.type === 'VALIDATION' && mensajeContiene(msg, 'cancelada')) {
    return { mensaje: MENSAJES.NC_FACTURA_CANCELADA, resetCdc: true, volverAConfirmacion: false };
  }
  if (error.type === 'VALIDATION' && mensajeContiene(msg, 'no se ha aprobado', 'aún no')) {
    return { mensaje: MENSAJES.NC_FACTURA_NO_APROBADA, resetCdc: true, volverAConfirmacion: false };
  }
  if (error.type === 'VALIDATION' && mensajeContiene(msg, 'supera el valor total', 'supera')) {
    return { mensaje: MENSAJES.NC_SALDO_INSUFICIENTE, resetCdc: false, volverAConfirmacion: true };
  }
  if (error.type === 'VALIDATION') {
    return {
      mensaje: `No se pudo emitir la nota de crédito: ${msg}. Indicame la corrección que haga falta.`,
      resetCdc: false,
      volverAConfirmacion: true,
    };
  }

  return { mensaje: MENSAJES.NC_ERROR_EMISION, resetCdc: false, volverAConfirmacion: false };
};

const confirmarYEmitirNotaCredito = async ({ contacto, conversacion, sesion, borrador }) => {
  const enProcesamiento = await sesionConversacionalService.transicionar(sesion.id, ESTADOS_ACTIVOS, ESTADOS_SESION.PROCESANDO, borrador);

  if (!enProcesamiento) {
    // Ya fue confirmada por un mensaje concurrente: no se dispara una segunda emisión.
    await responderYRegistrar(conversacion, contacto, MENSAJES.NC_YA_PROCESANDO);
    return;
  }

  await responderYRegistrar(conversacion, contacto, MENSAJES.NC_PROCESANDO);

  let resultado;
  try {
    resultado = await notaCreditoEmisionService.emitirNotaCredito({ empresa: contacto.empresa, cdc: borrador.cdc, items: borrador.items });
  } catch (error) {
    logger.error('Error al emitir nota de crédito', safeError(error));
    const { mensaje, resetCdc, volverAConfirmacion } = mapNotaCreditoEmisionError(error);

    if (resetCdc) {
      const borradorSinCdc = { ...borrador, cdc: null, cdcInvalido: false, totalFactura: null, totalIvaFactura: null };
      await sesionConversacionalService.transicionar(sesion.id, [ESTADOS_SESION.PROCESANDO], ESTADOS_SESION.CAPTURANDO_DATOS, borradorSinCdc);
    } else if (volverAConfirmacion) {
      await sesionConversacionalService.transicionar(sesion.id, [ESTADOS_SESION.PROCESANDO], ESTADOS_SESION.ESPERANDO_CONFIRMACION, borrador);
    } else {
      await sesionConversacionalService.transicionar(sesion.id, [ESTADOS_SESION.PROCESANDO], ESTADOS_SESION.ERROR, borrador);
    }

    await responderYRegistrar(conversacion, contacto, mensaje);
    return;
  }

  await registrarDocumentoEmitido({
    empresaId: contacto.empresa.id,
    numeroTelefono: contacto.numeroTelefono,
    tipo: 'NOTA_CREDITO',
    cdc: resultado.cdc,
    pdfNombre: resultado.pdfNombre,
    numeroDocumentoFormateado: resultado.numeroFormateado,
    estadoSifen: resultado.estadoSifen,
    sifenEstadoMensaje: resultado.sifenEstadoMensaje,
  });

  const datosCompletados = { ...borrador, resultadoEmision: resultado };
  await sesionConversacionalService.transicionar(sesion.id, [ESTADOS_SESION.PROCESANDO], ESTADOS_SESION.COMPLETADA, datosCompletados);
  await responderYRegistrar(conversacion, contacto, MENSAJES.NC_PENDIENTE_APROBACION);
};

// Único punto de entrada para cualquier mensaje de texto mientras operacionActiva ===
// NOTA_CREDITO. El CDC se extrae de forma determinística de `texto` (ver
// src/utils/cdc.js) en vez de vía IA: un LLM no reproduce con fiabilidad una cadena de
// 44 dígitos. La IA solo clasifica accion e interpreta los ítems, igual que
// facturaParser hace con cliente+ítems.
const procesarNotaCredito = async ({ contacto, conversacion, sesion, texto }) => {
  const borradorActual = sesion.datosTemporales;

  if (esSaludoPuro(texto)) {
    await responderYRegistrar(conversacion, contacto, mensajeRecordatorioNC(borradorActual));
    return;
  }

  let salidaParser;
  try {
    salidaParser = await notaCreditoParserService.interpretar({
      mensajeUsuario: texto,
      borradorActual: notaCreditoBorradorService.sanitizarBorradorParaIA(borradorActual),
    });
  } catch (error) {
    logger.error('Error interpretando mensaje de nota de crédito con OpenAI', safeError(error));
    await responderYRegistrar(conversacion, contacto, mapOpenAIErrorAMensaje(error));
    return;
  }

  const { accion } = salidaParser;

  if (accion === 'SALUDO') {
    await responderYRegistrar(conversacion, contacto, mensajeRecordatorioNC(borradorActual));
    return;
  }

  if (accion === 'FUERA_DE_ALCANCE') {
    await responderYRegistrar(conversacion, contacto, MENSAJES.FUERA_DE_ALCANCE);
    return;
  }

  if (accion === 'CANCELAR') {
    await cancelarNotaCredito({ contacto, conversacion, sesion });
    return;
  }

  const { cdc: cdcExtraido, candidatoInvalido } = extraerCdc(texto);

  const borrador = notaCreditoBorradorService.construirBorrador(
    { cdcExtraido, cdcInvalidoExtraido: Boolean(candidatoInvalido), itemsIA: salidaParser.items, advertenciasIA: salidaParser.advertencias },
    borradorActual,
  );

  // Igual idea que en facturaBorrador: si ya había ítems y este mensaje no trajo un
  // cdc nuevo ni cambió los ítems, probablemente la IA no entendió una corrección.
  const borradorAnteriorTeniaAlgo = Boolean(borradorActual?.cdc || borradorActual?.items?.length);
  const esCorreccionNoEntendida =
    borradorAnteriorTeniaAlgo && accion !== 'CONFIRMAR' && !cdcExtraido && notaCreditoBorradorService.sonEquivalentes(borrador, borradorActual);

  if (esCorreccionNoEntendida) {
    await responderYRegistrar(conversacion, contacto, MENSAJES.CORRECCION_NO_ENTENDIDA);
    return;
  }

  // Paso 1: CDC.
  if (!borrador.cdc) {
    const actualizada = await sesionConversacionalService.transicionar(sesion.id, ESTADOS_ACTIVOS, ESTADOS_SESION.CAPTURANDO_DATOS, borrador);
    if (!actualizada) return;
    await responderYRegistrar(conversacion, contacto, borrador.cdcInvalido ? MENSAJES.NC_CDC_INVALIDO : MENSAJES.NC_PEDIR_CDC);
    return;
  }

  // Paso 2: consultar el total de la factura original (solo si aún no lo tenemos para
  // este cdc: un cdc nuevo resetea totalFactura a null en construirBorrador).
  if (borrador.totalFactura == null) {
    let totalInfo;
    try {
      totalInfo = await notaCreditoEmisionService.consultarTotalFactura(contacto.empresa, borrador.cdc);
    } catch (error) {
      if (error instanceof FacturaApiError && (error.type === 'NOT_FOUND' || error.type === 'VALIDATION')) {
        const borradorSinCdc = { ...borrador, cdc: null, cdcInvalido: false, totalFactura: null, totalIvaFactura: null };
        const actualizada = await sesionConversacionalService.transicionar(sesion.id, ESTADOS_ACTIVOS, ESTADOS_SESION.CAPTURANDO_DATOS, borradorSinCdc);
        if (!actualizada) return;
        await responderYRegistrar(conversacion, contacto, error.type === 'NOT_FOUND' ? MENSAJES.NC_CDC_NO_ENCONTRADO : MENSAJES.NC_CDC_INVALIDO);
        return;
      }

      logger.error('Error consultando total de factura para NC', safeError(error));
      const actualizada = await sesionConversacionalService.transicionar(sesion.id, ESTADOS_ACTIVOS, ESTADOS_SESION.CAPTURANDO_DATOS, borrador);
      if (!actualizada) return;
      await responderYRegistrar(conversacion, contacto, MENSAJES.NC_CONSULTA_NO_DISPONIBLE);
      return;
    }

    const borradorConTotal = { ...borrador, totalFactura: totalInfo.total, totalIvaFactura: totalInfo.totalIva };

    if (borradorConTotal.items.length === 0) {
      const actualizada = await sesionConversacionalService.transicionar(sesion.id, ESTADOS_ACTIVOS, ESTADOS_SESION.CAPTURANDO_DATOS, borradorConTotal);
      if (!actualizada) return;
      await responderYRegistrar(conversacion, contacto, construirMensajeTotalEncontrado(totalInfo));
      return;
    }

    Object.assign(borrador, borradorConTotal);
  }

  // Paso 3: ítems faltantes.
  if (borrador.camposFaltantes.length > 0) {
    const actualizada = await sesionConversacionalService.transicionar(sesion.id, ESTADOS_ACTIVOS, ESTADOS_SESION.CAPTURANDO_DATOS, borrador);
    if (!actualizada) return;
    const mensaje = construirMensajeCamposFaltantes(borrador.camposFaltantes, {
      intentoConfirmar: accion === 'CONFIRMAR',
      advertencias: borrador.advertencias,
    });
    await responderYRegistrar(conversacion, contacto, mensaje);
    return;
  }

  // Paso 4: control de monto, antes de confirmar/emitir.
  if (borrador.totales.totalAcreditar > borrador.totalFactura) {
    const actualizada = await sesionConversacionalService.transicionar(sesion.id, ESTADOS_ACTIVOS, ESTADOS_SESION.CAPTURANDO_DATOS, borrador);
    if (!actualizada) return;
    await responderYRegistrar(conversacion, contacto, construirMensajeMontoExcedeTotal(borrador.totales.totalAcreditar, borrador.totalFactura));
    return;
  }

  if (accion === 'CONFIRMAR') {
    await confirmarYEmitirNotaCredito({ contacto, conversacion, sesion, borrador });
    return;
  }

  const actualizada = await sesionConversacionalService.transicionar(sesion.id, ESTADOS_ACTIVOS, ESTADOS_SESION.ESPERANDO_CONFIRMACION, borrador);
  if (!actualizada) return;
  await responderYRegistrar(conversacion, contacto, construirResumenConfirmacionNC(borrador));
};

const manejarSesion = async ({ contacto, conversacion, sesion, texto }) => {
  let sesionActual = sesion;

  if (ESTADOS_TERMINALES.includes(sesionActual.estado)) {
    sesionActual = await sesionConversacionalService.resetSesion(sesionActual.id);
  }

  // Este chequeo aplica a cualquier operación activa, así que va antes de los branches
  // por operacionActiva: si quedara después (como pasaba antes de agregar el flujo real
  // de NC), un mensaje llegado mientras una nota de crédito está en PROCESANDO caería en
  // procesarNotaCredito con un estado que ESTADOS_ACTIVOS no cubre, y cualquier
  // `transicionar` devolvería null — el mensaje se perdería en silencio en vez de avisar
  // "ya se está procesando".
  if (sesionActual.estado === ESTADOS_SESION.PROCESANDO) {
    let mensaje = MENSAJES.YA_PROCESANDO;
    if (sesionActual.operacionActiva === OPERACIONES.NOTA_CREDITO) mensaje = MENSAJES.NC_YA_PROCESANDO;
    else if (sesionActual.operacionActiva === OPERACIONES.CANCELAR_DOCUMENTO) mensaje = MENSAJES.CANC_YA_PROCESANDO;
    await responderYRegistrar(conversacion, contacto, mensaje);
    return;
  }

  if (sesionActual.operacionActiva === OPERACIONES.NOTA_CREDITO) {
    await procesarNotaCredito({ contacto, conversacion, sesion: sesionActual, texto });
    return;
  }

  if (sesionActual.operacionActiva === OPERACIONES.CANCELAR_DOCUMENTO) {
    await procesarCancelacion({ contacto, conversacion, sesion: sesionActual, texto });
    return;
  }

  const esContextoInicial = sesionActual.operacionActiva == null;
  await procesarConParser({ contacto, conversacion, sesion: sesionActual, texto, esContextoInicial });
};

// Ruteo 100% determinístico por interactive.list_reply.id / button_reply.id, sin pasar
// por el LLM. Nunca se interpreta el título visible del botón/row.
const manejarInteractivo = async ({ contacto, conversacion, sesion, waMessage }) => {
  const id = waMessage.interactive?.list_reply?.id || waMessage.interactive?.button_reply?.id;

  if (id === MENU_IDS.EMITIR_FACTURA) {
    await sesionConversacionalService.setOperacionActiva(sesion.id, OPERACIONES.EMITIR_FACTURA);
    await responderYRegistrar(conversacion, contacto, MENSAJES.PEDIR_DATOS_FACTURA);
    return;
  }

  if (id === MENU_IDS.NOTA_CREDITO) {
    // A diferencia de setOperacionActiva, también inicializa datosTemporales con el
    // borrador vacío de NC: su forma es distinta a la del borrador de factura que
    // pueda haber quedado ahí de una operación anterior.
    await sesionConversacionalService.iniciarOperacion(sesion.id, OPERACIONES.NOTA_CREDITO, notaCreditoBorradorService.borradorVacio());
    await responderYRegistrar(conversacion, contacto, MENSAJES.NC_PEDIR_CDC);
    return;
  }

  if (id === MENU_IDS.CANCELAR_DOCUMENTO) {
    // A diferencia de setOperacionActiva, también inicializa datosTemporales con el
    // borrador vacío propio de esta operación: su forma es distinta a la que pueda
    // haber quedado ahí de una operación anterior (factura o NC).
    await sesionConversacionalService.iniciarOperacion(sesion.id, OPERACIONES.CANCELAR_DOCUMENTO, cancelacionBorradorVacio());
    await responderYRegistrar(conversacion, contacto, MENSAJES.CANC_PEDIR_TIPO);
    return;
  }

  // id desconocido (o interactive sin list_reply/button_reply reconocible): se reintenta
  // mostrando el menú en vez de asumir cualquier operación.
  await enviarMenuPrincipalYRegistrar(conversacion, contacto);
};

// Punto de entrada para mensajes de tipo audio (incluye notas de voz): se descarga el
// binario desde WhatsApp, se transcribe con OpenAI (gpt-4o-mini-transcribe) y el texto
// resultante se procesa exactamente igual que un mensaje de texto entrante, vía
// manejarSesion. El archivo y su transcripción se registran en MensajeArchivo aparte
// (Mensaje.contenidoTexto queda en null para audio, igual que para el resto de los
// tipos multimedia).
const manejarAudioEntrante = async ({ contacto, conversacion, sesion, mensajeEntrante, waMessage }) => {
  const audio = waMessage.audio;

  if (!audio?.id) {
    await responderYRegistrar(conversacion, contacto, MENSAJES.AUDIO_NO_DISPONIBLE);
    return;
  }

  let buffer;
  let mimeType;
  try {
    ({ buffer, mimeType } = await whatsappService.downloadMedia(audio.id));
  } catch (error) {
    logger.error('Error descargando audio de WhatsApp', safeError(error));
    await responderYRegistrar(conversacion, contacto, MENSAJES.AUDIO_NO_DISPONIBLE);
    return;
  }

  mimeType = mimeType || audio.mime_type || null;

  let texto;
  try {
    texto = await transcripcionService.transcribir(buffer, mimeType);
  } catch (error) {
    logger.error('Error transcribiendo audio con OpenAI', safeError(error));
    await mensajeService.crearArchivo({
      mensajeId: mensajeEntrante.id,
      whatsappMediaId: audio.id,
      nombreArchivo: null,
      mimeType: mimeType || 'application/octet-stream',
      tamanioBytes: buffer.length,
      rutaArchivo: null,
    });
    await responderYRegistrar(conversacion, contacto, mapTranscripcionErrorAMensaje(error));
    return;
  }

  await mensajeService.crearArchivo({
    mensajeId: mensajeEntrante.id,
    whatsappMediaId: audio.id,
    nombreArchivo: null,
    mimeType: mimeType || 'application/octet-stream',
    tamanioBytes: buffer.length,
    rutaArchivo: null,
    transcripcion: texto,
  });

  if (!texto || !texto.trim()) {
    await responderYRegistrar(conversacion, contacto, MENSAJES.AUDIO_SIN_TEXTO);
    return;
  }

  await manejarSesion({ contacto, conversacion, sesion, texto });
};

// Las reacciones (emoji sobre un mensaje previo) llegan en value.messages[] como un
// evento propio (type: 'reaction', con id distinto al del mensaje reaccionado), así
// que no las deduplica registrarEntrante ni encajan en ningún tipo de TIPO_MENSAJE_POR_
// WHATSAPP. Al no dejar burbuja visible en el chat de WhatsApp, si cayeran en el
// fallback de "tipo no soportado" el usuario vería al bot reenviar el menú principal
// sin haber escrito nada. Se ignoran por completo: no ameritan ninguna respuesta.
const procesarMensajeEntrante = async (waMessage) => {
  if (waMessage.type === 'reaction') {
    logger.info('Reacción de WhatsApp ignorada');
    return;
  }

  const numeroTelefono = normalizarTelefono(waMessage.from);
  const fechaMensaje = waMessage.timestamp ? new Date(Number(waMessage.timestamp) * 1000) : new Date();

  // Log incondicional (no solo en ramas de error/duplicado/sin-permisos) para poder
  // diagnosticar desde los logs del contenedor qué llegó realmente y cuándo lo mandó
  // Meta (waMessage.timestamp) vs. cuándo lo procesamos nosotros (retraso = posible
  // reentrega/replay del webhook, ej. tras cambiar override_callback_uri).
  logger.info('Mensaje entrante de WhatsApp', {
    type: waMessage.type,
    id: waMessage.id,
    from: numeroTelefono,
    timestampMeta: fechaMensaje.toISOString(),
  });

  const contacto = await contactoService.findContactoActivoByNumero(numeroTelefono);

  if (!contacto) {
    logger.info('Mensaje recibido de número sin permisos');
    return;
  }

  const conversacion = await conversacionService.getOrCreateAbierta(contacto.id);
  await conversacionService.actualizarUltimoMensaje(conversacion.id);

  const tipo = TIPO_MENSAJE_POR_WHATSAPP[waMessage.type] || 'TEXTO';
  const textoEntrante = waMessage.type === 'text' ? waMessage.text?.body ?? null : null;

  const { mensaje: mensajeEntrante, duplicado } = await mensajeService.registrarEntrante({
    conversacionId: conversacion.id,
    whatsappMensajeId: waMessage.id,
    tipo,
    contenidoTexto: textoEntrante,
    fechaMensaje,
  });

  if (duplicado) {
    logger.info('Mensaje entrante duplicado ignorado', mensajeEntrante.whatsappMensajeId);
    return;
  }

  // Mensaje genuino (no duplicado) pero con timestamp de Meta muy anterior a "ahora":
  // no es un reintento del mismo wamid (eso ya se filtró arriba), sino una entrega
  // demorada del webhook (ej. el bot estuvo caído/inalcanzable y Meta reintentó con
  // backoff durante horas). Se deja registrado para el historial, pero no se dispara el
  // flujo normal: reaccionar recién ahora a algo escrito hace rato (ej. un "hola" que
  // dispara el menú principal fuera de cualquier contexto) confunde más de lo que ayuda.
  const antiguedadMs = Date.now() - fechaMensaje.getTime();
  if (antiguedadMs > MENSAJE_ANTIGUEDAD_MAXIMA_MS) {
    logger.warn('Mensaje entrante descartado por entrega demorada del webhook', {
      whatsappMensajeId: waMessage.id,
      antiguedadMs,
    });
    return;
  }

  const sesion = await sesionConversacionalService.getOrCreateSesion(conversacion.id);

  if (waMessage.type === 'interactive') {
    await manejarInteractivo({ contacto, conversacion, sesion, waMessage });
    return;
  }

  if (waMessage.type === 'audio') {
    await manejarAudioEntrante({ contacto, conversacion, sesion, mensajeEntrante, waMessage });
    return;
  }

  if (waMessage.type !== 'text' || !textoEntrante) {
    await responderYRegistrar(conversacion, contacto, MENSAJES.SOLO_TEXTO_SOPORTADO);
    await enviarMenuPrincipalYRegistrar(conversacion, contacto);
    return;
  }

  await manejarSesion({ contacto, conversacion, sesion, texto: textoEntrante });
};

const procesarActualizacionEstado = async (status) => {
  const nuevoEstado = ESTADO_WHATSAPP_A_ESTADO_MENSAJE[status.status];
  if (!nuevoEstado) return;
  await mensajeService.actualizarEstadoPorWhatsappId(status.id, nuevoEstado);
};

module.exports = { procesarMensajeEntrante, procesarActualizacionEstado };
