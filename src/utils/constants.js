const ESTADOS_SESION = Object.freeze({
  INICIO: 'INICIO',
  CAPTURANDO_DATOS: 'CAPTURANDO_DATOS',
  ESPERANDO_CONFIRMACION: 'ESPERANDO_CONFIRMACION',
  PROCESANDO: 'PROCESANDO',
  COMPLETADA: 'COMPLETADA',
  CANCELADA: 'CANCELADA',
  ERROR: 'ERROR',
});

// Estados en los que, ante un nuevo mensaje, la sesión se reinicia a INICIO.
// SesionConversacional tiene relación 1:1 con Conversacion (conversacionId es unique),
// así que "reiniciar" (en vez de cerrar la conversación y crear una nueva) es la única
// estrategia posible sin agregar modelos nuevos. El borrador anterior se descarta.
const ESTADOS_TERMINALES = Object.freeze([
  ESTADOS_SESION.COMPLETADA,
  ESTADOS_SESION.CANCELADA,
  ESTADOS_SESION.ERROR,
]);

const MENSAJE_BIENVENIDA =
  '¡Bienvenido a Factyble! Podés enviarme en un solo mensaje el nombre y RUC o cédula del cliente, junto con los productos, cantidades y precios.';

const MENSAJES = Object.freeze({
  NO_SE_PUDO_INTERPRETAR:
    'No pude identificar con seguridad todos los datos. Indicame el nombre y RUC o cédula del cliente, además de cada producto, cantidad y precio unitario.',
  FUERA_DE_ALCANCE: 'Por ahora puedo ayudarte a preparar y emitir facturas electrónicas.',
  OPENAI_NO_DISPONIBLE: 'No pude interpretar el mensaje en este momento. Podés intentar nuevamente en unos instantes.',
  YA_PROCESANDO: 'La factura ya está siendo procesada. Te enviaré el documento cuando esté disponible.',
  CANCELACION: 'La emisión fue cancelada.',
  ERROR_EMISION: 'No pudimos completar la emisión. La operación quedó registrada para evitar una emisión duplicada.',
  PROCESANDO_FACTURA: 'Tu factura está siendo emitida...',
  FACTURA_PENDIENTE_APROBACION:
    '📲 Quedate tranquilo/a, en cuanto sea aprobada te enviaré el PDF automáticamente por este chat. 🚀',
  SOLO_TEXTO_SOPORTADO: 'Por el momento solo puedo procesar mensajes de texto para emitir facturas.',
  AUDIO_NO_DISPONIBLE: 'No pude descargar el audio que enviaste. Probá reenviarlo o escribime el mensaje en texto.',
  AUDIO_NO_TRANSCRIBIBLE: 'No pude entender el audio que enviaste. Probá grabarlo de nuevo o escribime el mensaje en texto.',
  AUDIO_SIN_TEXTO: 'No detecté contenido hablado en el audio. Probá grabarlo de nuevo o escribime el mensaje en texto.',
  CORRECCION_NO_ENTENDIDA:
    'No entendí bien esa corrección, así que dejé la factura sin cambios. ¿Podés indicar puntualmente qué dato querés cambiar (cliente, producto, cantidad, precio o condición de venta)?',
  PEDIR_DATOS_FACTURA:
    'Contame los datos de la factura: nombre y RUC o cédula del cliente, y los productos o servicios con cantidad y precio.',
  MENU_PRINCIPAL_LOG: '[Menú principal] Hola 😁 ¿Qué querés hacer?',

  // Flujo de nota de crédito.
  NC_PEDIR_CDC:
    'Contame el CDC de la factura que querés acreditar: el código de 44 dígitos que figura en el KuDE, debajo del código QR.',
  NC_CDC_INVALIDO:
    'El CDC debe tener exactamente 44 dígitos numéricos. Verificalo e indicámelo de nuevo (podés copiarlo tal como aparece en el KuDE, debajo del QR).',
  NC_CDC_NO_ENCONTRADO:
    'No encontré ninguna factura con ese CDC en tu empresa. Verificá que el código esté completo y que la factura haya sido emitida desde esta cuenta.',
  NC_PEDIR_ITEMS: 'Contame qué ítems querés acreditar: descripción, cantidad y precio unitario de cada uno.',
  NC_FACTURA_CANCELADA: 'Esa factura está cancelada, no se pueden emitir notas de crédito sobre ella.',
  NC_FACTURA_NO_APROBADA:
    'La factura todavía no fue aprobada por SIFEN. Hay que esperar la aprobación antes de acreditarla. Probá de nuevo en unos minutos.',
  NC_SALDO_INSUFICIENTE:
    '⚠️ No se pudo emitir: ya existen notas de crédito anteriores sobre esta factura y, sumadas a esta, superan el total facturado. El saldo disponible para acreditar es menor. Reducí el monto e intentá de nuevo.',
  NC_CONFIG_FALTANTE:
    'Falta configuración en tu empresa (establecimiento/caja). Contactá al administrador para completarla antes de emitir notas de crédito.',
  NC_CONSULTA_NO_DISPONIBLE: 'No pude consultar la factura en este momento. Probá de nuevo en unos instantes.',
  NC_ERROR_EMISION:
    'No pudimos completar la emisión de la nota de crédito. La operación quedó registrada para evitar una emisión duplicada.',
  NC_CANCELACION: 'La nota de crédito fue cancelada.',
  NC_PROCESANDO: 'Tu nota de crédito está siendo emitida...',
  NC_PENDIENTE_APROBACION:
    '📲 Quedate tranquilo/a, en cuanto sea aprobada te enviaré el PDF automáticamente por este chat. 🚀',
  NC_YA_PROCESANDO: 'La nota de crédito ya está siendo procesada. Te aviso cuando esté disponible.',

  // Flujo de cancelación de documentos (factura o nota de crédito ya emitidas).
  CANC_PEDIR_TIPO: '¿Qué tipo de documento querés cancelar?\n1️⃣ Factura\n2️⃣ Nota de crédito',
  CANC_PEDIR_CDC:
    'Contame el CDC del documento que querés cancelar: el código de 44 dígitos que figura en el KuDE, debajo del código QR.',
  CANC_CDC_INVALIDO:
    'El CDC debe tener exactamente 44 dígitos numéricos. Verificalo e indicámelo de nuevo (podés copiarlo tal como aparece en el KuDE, debajo del QR).',
  CANC_CDC_FORMATO_INVALIDO: 'El CDC no tiene el formato correcto (debe ser 44 dígitos). ¿Podés verificarlo y enviármelo de nuevo?',
  CANC_CDC_NO_CORRESPONDE: 'Ese CDC no corresponde a ningún documento de tu empresa. Verificalo e intentá de nuevo.',
  CANC_YA_CANCELADO: 'Ese documento ya está cancelado, no hay nada más que hacer. ✅',
  CANC_SIN_CAJA: 'Hay una inconsistencia de configuración con este documento (sin caja asignada). Contactá al administrador para resolverla.',
  CANC_CANCELACION: 'Se descartó la cancelación del documento.',
  CANC_PROCESANDO: 'Estoy procesando la cancelación del documento...',
  CANC_YA_PROCESANDO: 'La cancelación ya está siendo procesada. Te aviso en cuanto tenga novedades.',
  CANC_ERROR:
    'No pude comunicarme con SIFEN para procesar la cancelación. El documento NO fue cancelado. Intentá de nuevo en unos minutos; si persiste, contactá al soporte.',
});

// Valores posibles de SesionConversacional.operacionActiva: qué operación del menú
// principal está activa para la conversación (null = ninguna, aún no eligió).
const OPERACIONES = Object.freeze({
  EMITIR_FACTURA: 'EMITIR_FACTURA',
  NOTA_CREDITO: 'NOTA_CREDITO',
  CANCELAR_DOCUMENTO: 'CANCELAR_DOCUMENTO',
});

// ids de las rows del list message del menú principal (ver whatsapp.service.js).
// El ruteo entrante se hace 100% por estos ids, nunca por el título visible.
const MENU_IDS = Object.freeze({
  EMITIR_FACTURA: 'op_emitir_factura',
  NOTA_CREDITO: 'op_nota_credito',
  CANCELAR_DOCUMENTO: 'op_cancelar_doc',
});

module.exports = {
  ESTADOS_SESION,
  ESTADOS_TERMINALES,
  MENSAJE_BIENVENIDA,
  MENSAJES,
  OPERACIONES,
  MENU_IDS,
};
