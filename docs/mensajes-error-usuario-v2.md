# Catálogo de mensajes al usuario — Versión 2 (orientada al usuario final)

Reescritura de todos los textos de error del bot con foco en claridad, tono cercano
(voseo) y estructura visual pensada para WhatsApp.

**Criterios aplicados en todos los mensajes:**

- 🔤 **Lenguaje simple**: sin jerga técnica ("API", "backend", "timeout"). El CDC se
  explica la primera vez que aparece en cada flujo.
- 👁️ **Anclaje visual**: cada mensaje arranca con un emoji que indica el tipo de
  situación — ⚠️ corregible por el usuario · ❌ error que corta el flujo · ⏳ hay que
  esperar · ✅ resuelto · 🔒 requiere al administrador.
- ➡️ **Siempre hay un "próximo paso"**: qué hacer, reenviar, esperar o a quién contactar.
- 📱 **Formato WhatsApp**: los `*asteriscos*` marcan negrita nativa de WhatsApp.
- 🧩 Los `<placeholders>` en cursiva son los mismos valores dinámicos que ya inyecta el código.

---

## 1. Interpretación de mensajes con IA (aplica a factura, NC y cancelación)

### `OPENAI_NO_DISPONIBLE`

> ⏳ *Ups, tuve un problema para leer tu mensaje.*
>
> No es nada que hayas hecho mal 🙂
> Esperá unos segundos y enviámelo de nuevo, por favor.

### `NO_SE_PUDO_INTERPRETAR`

> ⚠️ *No pude identificar con claridad todos los datos de la venta.*
>
> Por favor, enviame la información de esta forma:
>
> 👤 Nombre del cliente:
> 🪪 RUC o cédula:
> 📦 Producto o servicio:
> 🔢 Cantidad:
> 💰 Precio unitario:
>
> Si hay más de un producto, escribí cada uno por separado con su cantidad y precio.
> Luego te mostraré el resumen para que puedas confirmar antes de emitir la factura.

---

## 2. Emisión de factura

### `YA_PROCESANDO`

> ⏳ *Tu factura ya está en camino.*
>
> La estoy procesando en este momento.
> En cuanto esté lista, te envío el documento por acá 📄

### Datos rechazados — `construirMensajeDatosRechazados(<detalle>)`

> ⚠️ *No pude emitir la factura: hay un dato que necesita corrección.*
>
> 📋 Motivo: _<detalle del rechazo>_
>
> ✏️ Decime qué dato querés cambiar (por ejemplo: *"el RUC es 80012345-6"*)
> y cuando esté todo bien, confirmamos de nuevo. Tus datos siguen guardados,
> no hace falta cargar todo otra vez.

### `ERROR_EMISION`

> ❌ *No pude completar la emisión de la factura.*
>
> Tranqui: la operación quedó registrada y *no se va a emitir dos veces*.
>
> 🕐 Probá de nuevo en unos minutos escribiéndome *"hola"*.
> Si el problema sigue, contactá a soporte y avisá que la factura quedó pendiente.

---

## 3. Nota de crédito

### `NC_CDC_NO_ENCONTRADO`

> ⚠️ *No encontré ninguna factura con ese código en tu empresa.*
>
> Verificá que:
> 🔎 el CDC esté completo (son *44 números*, figura en el KuDE de la factura)
> 🏢 la factura haya sido emitida desde esta cuenta
>
> Cuando lo tengas, enviámelo de nuevo 👍

### `NC_CDC_INVALIDO`

> ⚠️ *El código que me enviaste no tiene el formato correcto.*
>
> El CDC son *exactamente 44 números*, sin letras ni espacios.
> Lo encontrás en el KuDE (el PDF de la factura), generalmente debajo del código de barras.
>
> Copialo completo y enviámelo de nuevo 🔎

### `NC_CONSULTA_NO_DISPONIBLE`

> ⏳ *No pude consultar los datos de esa factura en este momento.*
>
> Es un problema temporal de conexión.
> Esperá unos instantes y enviame el código de nuevo, por favor.

### Monto excede el total — `construirMensajeMontoExcedeTotal(<monto>, <total>)`

> ⚠️ *El monto a acreditar es mayor que el saldo de la factura.*
>
> 💰 Querés acreditar: *Gs. <totalAcreditar>*
> 📄 Saldo disponible de la factura: *Gs. <totalFactura>*
>
> Ajustá las cantidades o precios de la nota de crédito para que no supere
> ese saldo, y volvemos a intentar ✏️

### `NC_YA_PROCESANDO`

> ⏳ *Tu nota de crédito ya está en camino.*
>
> Te aviso por acá en cuanto esté disponible 📄

### `NC_CONFIG_FALTANTE`

> 🔒 *Falta un dato de configuración en tu empresa para poder emitir notas de crédito.*
>
> Esto no lo podés resolver desde el chat: pedile al *administrador de tu cuenta*
> que complete la configuración de establecimiento y caja.
>
> Cuando esté listo, volvé a intentarlo por acá 👍

### `NC_FACTURA_CANCELADA`

> ❌ *Esa factura está cancelada.*
>
> Sobre una factura cancelada no se pueden emitir notas de crédito,
> porque ya no tiene validez fiscal.
>
> Si querés acreditar otra factura, enviame su CDC y arrancamos de nuevo 🔄

### `NC_FACTURA_NO_APROBADA`

> ⏳ *Esa factura todavía no fue aprobada por la SET (SIFEN).*
>
> Hay que esperar la aprobación antes de poder acreditarla.
> Suele demorar unos minutos ⌛
>
> Probá de nuevo en un rato enviándome el mismo CDC.

### `NC_SALDO_INSUFICIENTE`

> ⚠️ *El monto supera lo que queda disponible de esa factura.*
>
> Ya existen notas de crédito anteriores sobre esta factura y, sumando esta,
> se pasaría del total facturado.
>
> ✏️ Bajá el monto de esta nota de crédito y confirmamos de nuevo.

### Error de validación genérico — dinámico

> ⚠️ *No pude emitir la nota de crédito.*
>
> 📋 Motivo: _<detalle>_
>
> ✏️ Decime qué dato querés corregir y volvemos a intentar.
> Lo que ya cargaste sigue guardado.

### `NC_ERROR_EMISION`

> ❌ *No pude completar la emisión de la nota de crédito.*
>
> La operación quedó registrada y *no se va a emitir dos veces*.
>
> 🕐 Probá de nuevo en unos minutos escribiéndome *"hola"*.
> Si el problema sigue, contactá a soporte.

---

## 4. Cancelación de documentos

### `CANC_CDC_INVALIDO`

> ⚠️ *El código que me enviaste no tiene el formato correcto.*
>
> El CDC son *exactamente 44 números*, sin letras ni espacios.
> Lo encontrás en el KuDE del documento, debajo del código de barras.
>
> Copialo completo y enviámelo de nuevo 🔎

### `CANC_YA_PROCESANDO`

> ⏳ *La cancelación ya está en proceso.*
>
> Te aviso por acá en cuanto tenga novedades.

### Sugerir tipo alternativo — `construirMensajeSugerirTipoAlternativo(<borrador>)`

> 🤔 *No encontré ninguna <factura / nota de crédito> con ese código en tu empresa.*
>
> ¿Puede ser que en realidad sea una *<tipo alternativo>*?
>
> Respondeme *"sí"* para buscarla como <tipo alternativo>,
> o enviame otro CDC si el código estaba mal.

### `CANC_CDC_NO_CORRESPONDE`

> ❌ *Ese código no corresponde a ningún documento de tu empresa.*
>
> Ya lo busqué como factura y como nota de crédito, y no aparece.
>
> 🔎 Verificá el CDC en el KuDE del documento y, cuando lo tengas,
> escribime de nuevo para empezar otra cancelación.

### `CANC_YA_CANCELADO`

> ✅ *¡Buenas noticias! Ese documento ya está cancelado.*
>
> No hace falta hacer nada más 👍
> ¿Te ayudo con otra cosa?

### Notas de crédito vinculadas — `construirMensajeNotaCreditoVinculadas(<msg>)`

> ❌ *No se puede cancelar esta factura.*
>
> Tiene *<N> nota(s) de crédito aprobada(s)* vinculada(s), y la SET no permite
> cancelar una factura en esa situación.
>
> 💡 Si necesitás dejarla sin efecto, la alternativa es emitir una
> *nota de crédito por el saldo restante*. Escribime *"nota de crédito"* y te guío.

### Estado no aprobado — `construirMensajeEstadoNoAprobado(<msg>)`

> ⚠️ *Ese documento no se puede cancelar todavía.*
>
> 📄 Estado actual: *<estado>*
> Solo se pueden cancelar documentos *aprobados* por la SET.
>
> ⏳ Si lo emitiste hace poco, esperá unos minutos y volvé a intentar.

### `CANC_SIN_CAJA`

> 🔒 *Encontré una inconsistencia de configuración con este documento.*
>
> Esto no lo podés resolver desde el chat: contactá al *administrador de tu cuenta*
> para que lo revise. Cuando esté resuelto, volvé a intentarlo por acá.

### `CANC_CDC_FORMATO_INVALIDO`

> ⚠️ *El código no tiene el formato correcto.*
>
> El CDC debe tener *44 números exactos*.
> ¿Podés verificarlo en el KuDE y enviármelo de nuevo? 🔎

### `CANC_ERROR`

> ❌ *No pude comunicarme con la SET (SIFEN) para procesar la cancelación.*
>
> ‼️ Importante: *el documento NO fue cancelado*, sigue vigente.
>
> 🕐 Probá de nuevo en unos minutos.
> Si el problema persiste, contactá a soporte.

### Rechazo de SIFEN — `construirMensajeRechazoSifen(<resultado>)`

> ⚠️ *La SET (SIFEN) rechazó la cancelación.*
>
> 📄 El documento sigue en estado: *<estado>*
> 📋 Motivo: _<mensaje>_ (código <código>)
>
> _(Se agrega solo si el motivo menciona plazo vencido:)_
> 💡 Como ya pasó el plazo para cancelar, la alternativa es emitir una
> *nota de crédito* por el total. Escribime *"nota de crédito"* y te guío.

---

## 5. Audios y otros tipos de mensaje

### `AUDIO_NO_DISPONIBLE`

> ⚠️ *No pude descargar el audio que me enviaste.*
>
> Probá una de estas opciones:
> 🔁 Reenviá el audio
> ⌨️ O escribime el mensaje en texto

### `AUDIO_NO_TRANSCRIBIBLE`

> ⚠️ *No logré entender el audio.*
>
> Puede que haya mucho ruido de fondo o se escuche bajito 🎙️
>
> 🔁 Probá grabarlo de nuevo, más cerca del micrófono
> ⌨️ O escribime el mensaje en texto

### `AUDIO_SIN_TEXTO`

> ⚠️ *El audio llegó, pero no detecté ninguna voz.*
>
> 🔁 Probá grabarlo de nuevo
> ⌨️ O escribime el mensaje en texto

### `SOLO_TEXTO_SOPORTADO`

> 📝 *Por ahora solo puedo procesar mensajes de texto y audios.*
>
> Todavía no puedo leer imágenes ni archivos 🙏
> Escribime lo que necesitás y te ayudo con gusto.

### `FUERA_DE_ALCANCE`

> 🤖 *Eso se escapa un poco de lo que sé hacer.*
>
> Puedo ayudarte con:
> 🧾 Emitir facturas electrónicas
> 📄 Emitir notas de crédito
> ❌ Cancelar documentos
>
> Contame cuál de estas necesitás 👍

---

## 6. Correcciones y pedidos ambiguos

### `CORRECCION_NO_ENTENDIDA`

> 🤔 *No entendí bien qué querés cambiar, así que dejé todo como estaba.*
>
> Decime puntualmente el dato a corregir, por ejemplo:
> 👤 *"el cliente es Juan Pérez"*
> 💰 *"el precio es 150.000"*
> 🔢 *"son 3 unidades"*
>
> Podés cambiar: cliente, producto, cantidad, precio o condición de venta.

### Cancelación vs. nota de crédito (mensaje inline — mover a `MENSAJES`)

> 🤔 *Quiero asegurarme de entenderte bien. ¿Cuál de estas dos necesitás?*
>
> ❌ *Cancelar el documento*: queda anulado por completo y pierde validez
> fiscal ante la SET.
>
> 📄 *Nota de crédito*: acredita una parte (o el total) de una factura
> que sigue vigente. Es lo usual para devoluciones o descuentos.
>
> Respondeme *"cancelar"* o *"nota de crédito"* 👍

---

## Notas de implementación

1. **Emojis como código de severidad**: mantener la convención ⚠️ / ❌ / ⏳ / ✅ / 🔒
   en futuros mensajes para que el usuario aprenda a leerlos de un vistazo.
2. **El mensaje inline de la sección 6** conviene moverlo a `constants.js` como
   `CANC_VS_NC_AMBIGUO` para unificar el manejo.
3. **Negritas**: WhatsApp renderiza `*texto*` como negrita — verificar que los
   asteriscos se envíen literales (no como Markdown procesado).
4. **Los mensajes genéricos** (`ERROR_EMISION`, `NC_ERROR_EMISION`, `CANC_ERROR`,
   `OPENAI_NO_DISPONIBLE`) siguen agrupando varias causas; la mejora acá es de tono
   y próximos pasos, pero para soporte seguiría siendo útil loguear/adjuntar un ID
   de referencia corto (ej. últimos 6 caracteres del request id) que el usuario
   pueda citar: *"Código de referencia: ABC123"*.
