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

const MENSAJE_BIENVENIDA = `👋 *¡Hola de nuevo!*

Seguimos con la operación que teníamos en curso 😉
Podés mandarme todo en un solo mensaje: *nombre y RUC o cédula del cliente*,
más los *productos con cantidad y precio*.

Si preferís empezar de cero, escribime *"cancelar"*.`;

// Si Meta reentrega un webhook mucho después de que el usuario efectivamente escribió
// (ej. el bot estuvo caído/inalcanzable y Meta reintentó con backoff durante horas), el
// mensaje llega con un `timestamp` viejo pero se procesa como si fuera nuevo: si era un
// simple "hola", el usuario recibe el menú principal sin haber escrito nada en ese
// momento. Por encima de este umbral, el mensaje se registra pero no dispara el flujo
// normal (ver botOrchestrator.service.js).
const MENSAJE_ANTIGUEDAD_MAXIMA_MS = 15 * 60 * 1000;

const MENSAJES = Object.freeze({
  NO_SE_PUDO_INTERPRETAR: `⚠️ *No pude identificar con claridad todos los datos de la venta.*

Por favor, enviame la información de esta forma:

👤 Nombre del cliente:
🪪 RUC o cédula:
📦 Producto o servicio:
🔢 Cantidad:
💰 Precio unitario:

Si hay más de un producto, escribí cada uno por separado con su cantidad y precio.
Luego te mostraré el resumen para que puedas confirmar antes de emitir la factura.`,

  FUERA_DE_ALCANCE: `🤖 *Eso se escapa un poco de lo que sé hacer.*

Puedo ayudarte con:
🧾 Emitir facturas electrónicas
📄 Emitir notas de crédito
❌ Cancelar documentos

Contame cuál de estas necesitás 👍`,

  OPENAI_NO_DISPONIBLE: `⏳ *Ups, tuve un problema para leer tu mensaje.*

No es nada que hayas hecho mal 🙂
Esperá unos segundos y enviámelo de nuevo, por favor.`,

  YA_PROCESANDO: `⏳ *Tu factura ya está en camino.*

La estoy procesando en este momento.
En cuanto esté lista, te envío el documento por acá 📄`,

  CANCELACION: `👍 *Listo, descarté la factura.*

No se emitió nada, quedate tranqui.
Cuando quieras arrancar de nuevo, escribime *"hola"* 👋`,

  ERROR_EMISION: `❌ *No pude completar la emisión de la factura.*

Tranqui: la operación quedó registrada y *no se va a emitir dos veces*.

🕐 Probá de nuevo en unos minutos escribiéndome *"hola"*.
Si el problema sigue, contactá a soporte y avisá que la factura quedó pendiente.`,

  PROCESANDO_FACTURA: `⏳ *¡Perfecto! Estoy emitiendo tu factura...*

Dame unos segundos ⚙️`,

  // Fallback: la factura ya se emitió, pero no se pudo adjuntar el PDF por este chat en el
  // momento (falla al descargarlo o al subirlo a WhatsApp). No hay reintento automático.
  FACTURA_EMITIDA_SIN_PDF: `✅ *¡Tu factura fue emitida correctamente!*

Sin embargo, no pude adjuntarte el PDF por este chat en este momento 😕
Contactá a soporte (wa.me/595976788698) para que te lo hagan llegar 📄`,

  SOLO_TEXTO_SOPORTADO: `📝 *Por ahora solo puedo procesar mensajes de texto y audios.*

Todavía no puedo leer imágenes ni archivos 🙏
Escribime lo que necesitás y te ayudo con gusto.`,

  AUDIO_NO_DISPONIBLE: `⚠️ *No pude descargar el audio que me enviaste.*

Probá una de estas opciones:
🔁 Reenviá el audio
⌨️ O escribime el mensaje en texto`,

  AUDIO_NO_TRANSCRIBIBLE: `⚠️ *No logré entender el audio.*

Puede que haya mucho ruido de fondo o se escuche bajito 🎙️

🔁 Probá grabarlo de nuevo, más cerca del micrófono
⌨️ O escribime el mensaje en texto`,

  AUDIO_SIN_TEXTO: `⚠️ *El audio llegó, pero no detecté ninguna voz.*

🔁 Probá grabarlo de nuevo
⌨️ O escribime el mensaje en texto`,

  CORRECCION_NO_ENTENDIDA: `🤔 *No entendí bien qué querés cambiar, así que dejé todo como estaba.*

Decime puntualmente el dato a corregir, por ejemplo:
👤 *"el cliente es Juan Pérez"*
💰 *"el precio es 150.000"*
🔢 *"son 3 unidades"*

Podés cambiar: cliente, producto, cantidad, precio o condición de venta.`,

  PEDIR_DATOS_FACTURA: `✍️ *¡Vamos a emitir tu factura!*

Enviame estos datos (puede ser todo junto en un mensaje, o por audio 🎙️):

👤 Nombre del cliente
🪪 RUC o cédula
📦 Producto o servicio
🔢 Cantidad
💰 Precio unitario

Ejemplo: _"Factura para Juan Pérez, cédula 4123456, 2 mouse inalámbricos a 150.000"_`,

  MENU_PRINCIPAL_LOG: '[Menú principal] 👋 ¡Hola! Soy tu asistente de facturación. ¿Qué querés hacer?',

  // Ambigüedad entre cancelar un documento por completo y emitir una nota de crédito
  // parcial (ver detectarIntentoCancelacionDocumento en botOrchestrator.service.js).
  CANC_VS_NC_AMBIGUO: `🤔 *Quiero asegurarme de entenderte bien. ¿Cuál de estas dos necesitás?*

❌ *Cancelar el documento*: queda anulado por completo y pierde validez
fiscal ante la DNIT.

📄 *Nota de crédito*: acredita una parte (o el total) de una factura
que sigue vigente. Es lo usual para devoluciones o descuentos.

Respondeme *"cancelar"* o *"nota de crédito"* 👍`,

  // Flujo de nota de crédito.
  NC_PEDIR_CDC: `✍️ *¡Vamos a emitir una nota de crédito!*

Primero necesito identificar la factura a acreditar.
Enviame su *CDC*: el código de *44 números* que figura en el KuDE
(el PDF de la factura), debajo del código QR 🔎`,

  NC_CDC_INVALIDO: `⚠️ *El código que me enviaste no tiene el formato correcto.*

El CDC son *exactamente 44 números*, sin letras ni espacios.
Lo encontrás en el KuDE (el PDF de la factura), generalmente debajo del código de barras.

Copialo completo y enviámelo de nuevo 🔎`,

  NC_CDC_NO_ENCONTRADO: `⚠️ *No encontré ninguna factura con ese código en tu empresa.*

Verificá que:
🔎 el CDC esté completo (son *44 números*, figura en el KuDE de la factura)
🏢 la factura haya sido emitida desde esta cuenta

Cuando lo tengas, enviámelo de nuevo 👍`,

  NC_PEDIR_ITEMS: `✍️ *Seguimos con tu nota de crédito 😉*

Contame qué ítems querés acreditar:
📦 Descripción
🔢 Cantidad
💰 Precio unitario`,

  NC_FACTURA_CANCELADA: `❌ *Esa factura está cancelada.*

Sobre una factura cancelada no se pueden emitir notas de crédito,
porque ya no tiene validez fiscal.

Si querés acreditar otra factura, enviame su CDC y arrancamos de nuevo 🔄`,

  NC_FACTURA_NO_APROBADA: `⏳ *Esa factura todavía no fue aprobada por la DNIT (SIFEN).*

Hay que esperar la aprobación antes de poder acreditarla.
Suele demorar unos minutos ⌛

Probá de nuevo en un rato enviándome el mismo CDC.`,

  NC_SALDO_INSUFICIENTE: `⚠️ *El monto supera lo que queda disponible de esa factura.*

Ya existen notas de crédito anteriores sobre esta factura y, sumando esta,
se pasaría del total facturado.

✏️ Bajá el monto de esta nota de crédito y confirmamos de nuevo.`,

  NC_CONFIG_FALTANTE: `🔒 *Falta un dato de configuración en tu empresa para poder emitir notas de crédito.*

Esto no lo podés resolver desde el chat: pedile al *administrador de tu cuenta*
que complete la configuración de establecimiento y caja.

Cuando esté listo, volvé a intentarlo por acá 👍`,

  NC_CONSULTA_NO_DISPONIBLE: `⏳ *No pude consultar los datos de esa factura en este momento.*

Es un problema temporal de conexión.
Esperá unos instantes y enviame el código de nuevo, por favor.`,

  NC_ERROR_EMISION: `❌ *No pude completar la emisión de la nota de crédito.*

La operación quedó registrada y *no se va a emitir dos veces*.

🕐 Probá de nuevo en unos minutos escribiéndome *"hola"*.
Si el problema sigue, contactá a soporte.`,

  NC_CANCELACION: `👍 *Listo, descarté la nota de crédito.*

No se emitió nada.
Cuando quieras arrancar de nuevo, escribime *"hola"* 👋`,

  NC_PROCESANDO: `⏳ *¡Perfecto! Estoy emitiendo tu nota de crédito...*

Dame unos segundos ⚙️`,

  // Fallback (igual que FACTURA_EMITIDA_SIN_PDF): la NC se emitió, pero no se pudo
  // adjuntar el PDF por este chat en el momento. No hay reintento automático.
  NC_EMITIDA_SIN_PDF: `✅ *¡Tu nota de crédito fue emitida correctamente!*

Sin embargo, no pude adjuntarte el PDF por este chat en este momento 😕
Contactá a soporte (wa.me/595976788698) para que te lo hagan llegar 📄`,

  NC_YA_PROCESANDO: `⏳ *Tu nota de crédito ya está en camino.*

Te aviso por acá en cuanto esté disponible 📄`,

  // Flujo de cancelación de documentos (factura o nota de crédito ya emitidas).
  CANC_PEDIR_TIPO: `✍️ *Vamos a cancelar un documento.*

¿Qué tipo de documento es?

1️⃣ 🧾 Factura
2️⃣ 📄 Nota de crédito

Respondeme con el número o el nombre 👍`,

  CANC_PEDIR_CDC: `✍️ *Ahora enviame el CDC del documento a cancelar.*

Es el código de *44 números* que figura en el KuDE,
debajo del código QR 🔎`,

  CANC_CDC_INVALIDO: `⚠️ *El código que me enviaste no tiene el formato correcto.*

El CDC son *exactamente 44 números*, sin letras ni espacios.
Lo encontrás en el KuDE del documento, debajo del código de barras.

Copialo completo y enviámelo de nuevo 🔎`,

  CANC_CDC_FORMATO_INVALIDO: `⚠️ *El código no tiene el formato correcto.*

El CDC debe tener *44 números exactos*.
¿Podés verificarlo en el KuDE y enviármelo de nuevo? 🔎`,

  CANC_CDC_NO_CORRESPONDE: `❌ *Ese código no corresponde a ningún documento de tu empresa.*

Ya lo busqué como factura y como nota de crédito, y no aparece.

🔎 Verificá el CDC en el KuDE del documento y, cuando lo tengas,
escribime de nuevo para empezar otra cancelación.`,

  CANC_YA_CANCELADO: `✅ *¡Buenas noticias! Ese documento ya está cancelado.*

No hace falta hacer nada más 👍
¿Te ayudo con otra cosa?`,

  CANC_SIN_CAJA: `🔒 *Encontré una inconsistencia de configuración con este documento.*

Esto no lo podés resolver desde el chat: contactá al *administrador de tu cuenta*
para que lo revise. Cuando esté resuelto, volvé a intentarlo por acá.`,

  CANC_CANCELACION: `👍 *Perfecto, no cancelo nada.*

El documento *sigue vigente*, tal como estaba ✅
¿Te ayudo con otra cosa?`,

  CANC_PROCESANDO: `⏳ *Estoy procesando la cancelación ante la DNIT (SIFEN)...*

Dame unos segundos ⚙️`,

  CANC_YA_PROCESANDO: `⏳ *La cancelación ya está en proceso.*

Te aviso por acá en cuanto tenga novedades.`,

  CANC_ERROR: `❌ *No pude comunicarme con la DNIT (SIFEN) para procesar la cancelación.*

‼️ Importante: *el documento NO fue cancelado*, sigue vigente.

🕐 Probá de nuevo en unos minutos.
Si el problema persiste, contactá a soporte.`,
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
  MENSAJE_ANTIGUEDAD_MAXIMA_MS,
  MENSAJES,
  OPERACIONES,
  MENU_IDS,
};
