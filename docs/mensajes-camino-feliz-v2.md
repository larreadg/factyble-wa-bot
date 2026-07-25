# Catálogo de mensajes de camino feliz — Versión 2 (orientada al usuario final)

Reescritura de los mensajes del flujo normal con los mismos criterios que
`mensajes-error-usuario-v2.md`: lenguaje simple, voseo, anclaje visual con emojis
y siempre un próximo paso claro.

**Convención de emojis (extiende la del catálogo de errores):**

- ✍️ el bot está pidiendo datos · 📋 resumen para confirmar · ⏳ procesando /
  esperando aprobación · ✅ éxito · 👋 saludo/menú · 🧾 factura · 📄 nota de crédito.
- Los `*asteriscos*` son negrita nativa de WhatsApp.
- Los `<placeholders>` son los valores dinámicos que ya inyecta el código.

---

## 1. Entrada / menú principal

### Menú principal (list message interactivo)

**Header:** `Factyble 🧾`
**Body:**

> 👋 *¡Hola! Soy tu asistente de facturación.*
>
> Elegí qué querés hacer y te guío paso a paso:

**Opciones** (WhatsApp limita los títulos de fila a 24 caracteres):

| Título | Descripción de fila (72 car. máx.) |
|---|---|
| 🧾 Emitir factura | Creá una factura electrónica en minutos |
| 📄 Nota de crédito | Acreditá una factura ya emitida |
| ❌ Cancelar documento | Anulá una factura o nota de crédito |

> 💡 Sugerencia extra: en el footer del list message se puede agregar
> *"También podés escribirme o mandarme un audio 🎙️"* para que el usuario
> descubra que no está obligado a usar el menú.

### `MENSAJE_BIENVENIDA` (saludo cuando ya hay una operación en curso)

> 👋 *¡Hola de nuevo!*
>
> Seguimos con la operación que teníamos en curso 😉
> Podés mandarme todo en un solo mensaje: *nombre y RUC o cédula del cliente*,
> más los *productos con cantidad y precio*.
>
> Si preferís empezar de cero, escribime *"cancelar"*.

---

## 2. Flujo: Emitir factura

### Paso 1 — `PEDIR_DATOS_FACTURA`

> ✍️ *¡Vamos a emitir tu factura!*
>
> Enviame estos datos (puede ser todo junto en un mensaje, o por audio 🎙️):
>
> 👤 Nombre del cliente
> 🪪 RUC o cédula
> 📦 Producto o servicio
> 🔢 Cantidad
> 💰 Precio unitario
>
> Ejemplo: _"Factura para Juan Pérez, cédula 4123456, 2 mouse inalámbricos a 150.000"_

### Paso 2 — Campos faltantes — `construirMensajeCamposFaltantes(...)`

> ✍️ *¡Vamos bien! Solo me faltan estos datos:*
>
> 🔸 _<campo faltante 1>_
> 🔸 _<campo faltante 2>_
>
> _(Si hay advertencias:)_
> ⚠️ _<advertencia>_
>
> Enviámelos y te muestro el resumen para confirmar 👍

Variante cuando el usuario ya intentó confirmar:

> ✋ *Un momento: todavía no puedo emitir la factura.*
>
> Antes necesito:
> 🔸 _<campo faltante>_
>
> En cuanto me los pases, confirmamos 👍

### Paso 3 — Resumen de confirmación — `construirResumenConfirmacion(borrador)`

> 📋 *Resumen de tu factura*
> ━━━━━━━━━━━━━━━
> 👤 Cliente: *<nombre>*
> 🪪 RUC/CI: *<documento>*
> 💳 Condición: *<contado/crédito>*
>
> 🛒 *Detalle:*
> 📦 <descripción>
>     <cantidad> × Gs. <precio> — IVA <tipo> — Subtotal: Gs. <subtotal>
> _(un bloque por ítem)_
>
> ━━━━━━━━━━━━━━━
> 💰 *TOTAL: Gs. <total>*
>
> ¿Está todo correcto? 😊
> ✅ Escribí *"sí"* para emitir
> ✏️ O decime qué querés corregir
> ❌ O escribí *"cancelar"* para descartar

### Paso 4 — `PROCESANDO_FACTURA`

> ⏳ *¡Perfecto! Estoy emitiendo tu factura...*
>
> Dame unos segundos ⚙️

### Paso 5 — `FACTURA_PENDIENTE_APROBACION`

> ✅ *¡Tu factura fue enviada a la SET (SIFEN) para su aprobación!*
>
> 📲 No hace falta que hagas nada más: en cuanto sea aprobada,
> te llega el *PDF automáticamente* por este chat.
>
> Suele demorar solo unos minutos ⏳

### Paso 6 — Caption del PDF — `construirCaptionPdf(documento)`

> ✅ *¡Factura aprobada!* 🎉
> 🧾 Factura nro. *<numeroDocumentoFormateado>*
>
> Ya podés reenviarla a tu cliente 📤

_(Si aún no hay número: solo "✅ ¡Factura aprobada! 🎉")_

---

## 3. Flujo: Nota de crédito

### Paso 1 — `NC_PEDIR_CDC`

> ✍️ *¡Vamos a emitir una nota de crédito!*
>
> Primero necesito identificar la factura a acreditar.
> Enviame su *CDC*: el código de *44 números* que figura en el KuDE
> (el PDF de la factura), debajo del código QR 🔎

### Paso 2 — Factura encontrada — `construirMensajeTotalEncontrado({...})`

> ✅ *¡Encontré la factura!*
>
> 💰 Total facturado: *Gs. <total>*
> 🧾 IVA incluido: Gs. <totalIva>
>
> Ahora contame *qué querés acreditar*:
> 📦 Producto o servicio
> 🔢 Cantidad
> 💰 Precio unitario
>
> Puede ser una parte o el total de la factura.

### Paso 2b — Recordatorio — `NC_PEDIR_ITEMS`

> ✍️ *Seguimos con tu nota de crédito 😉*
>
> Contame qué ítems querés acreditar:
> 📦 Descripción
> 🔢 Cantidad
> 💰 Precio unitario

### Paso 3 — Campos faltantes

Mismo helper y formato que factura (sección 2, paso 2).

### Paso 4 — Resumen — `construirResumenConfirmacionNC(borrador)`

> 📋 *Resumen de tu nota de crédito*
> ━━━━━━━━━━━━━━━
> 🔗 Sobre la factura CDC: <abreviado>...
> 💰 Total facturado: Gs. <totalFactura>
>
> 🛒 *Vas a acreditar:*
> 📦 <descripción>
>     <cantidad> × Gs. <precio> — Subtotal: Gs. <subtotal>
> _(un bloque por ítem)_
>
> ━━━━━━━━━━━━━━━
> 💰 *TOTAL A ACREDITAR: Gs. <totalNC>*
>
> ¿Confirmás la emisión? 😊
> ✅ Escribí *"sí"* para emitir
> ✏️ O decime qué querés corregir
> ❌ O escribí *"cancelar"* para descartar

### Paso 5 — `NC_PROCESANDO`

> ⏳ *¡Perfecto! Estoy emitiendo tu nota de crédito...*
>
> Dame unos segundos ⚙️

### Paso 6 — `NC_PENDIENTE_APROBACION`

> ✅ *¡Tu nota de crédito fue enviada a la SET (SIFEN) para su aprobación!*
>
> 📲 En cuanto sea aprobada, te llega el *PDF automáticamente* por este chat.
> Suele demorar solo unos minutos ⏳

### Paso 7 — Caption del PDF

> ✅ *¡Nota de crédito aprobada!* 🎉
> 📄 Nota de crédito nro. *<numero>*
>
> Ya podés reenviarla a tu cliente 📤

---

## 4. Flujo: Cancelar documento

### Paso 1 — `CANC_PEDIR_TIPO`

> ✍️ *Vamos a cancelar un documento.*
>
> ¿Qué tipo de documento es?
>
> 1️⃣ 🧾 Factura
> 2️⃣ 📄 Nota de crédito
>
> Respondeme con el número o el nombre 👍

### Paso 2 — `CANC_PEDIR_CDC`

> ✍️ *Ahora enviame el CDC del documento a cancelar.*
>
> Es el código de *44 números* que figura en el KuDE,
> debajo del código QR 🔎

### Paso 3 — Resumen — `construirResumenConfirmacionCancelacion(borrador)`

> ⚠️ *Confirmación de cancelación*
> ━━━━━━━━━━━━━━━
> Vas a cancelar esta *<factura / nota de crédito>*:
>
> 🔗 CDC: <abreviado>...
>
> ‼️ *Atención: esta acción es irreversible.*
> El documento quedará *anulado y sin validez fiscal* ante la SET.
>
> ¿Confirmás la cancelación?
> ✅ Escribí *"sí"* para cancelar el documento
> ❌ O escribí *"no"* para dejarlo como está

### Paso 4 — `CANC_PROCESANDO`

> ⏳ *Estoy procesando la cancelación ante la SET (SIFEN)...*
>
> Dame unos segundos ⚙️

### Paso 5 — Éxito — `construirMensajeCancelacionExitosa({...})`

> ✅ *Documento cancelado correctamente*
> ━━━━━━━━━━━━━━━
> 🔗 CDC: <abreviado>...
> 📄 Estado en SIFEN: *<estado>*
>
> El documento quedó *anulado y sin validez fiscal*.
> ¿Te ayudo con algo más? 😊

---

## 5. Abandono voluntario de un flujo

### `CANCELACION` (factura descartada antes de emitir)

> 👍 *Listo, descarté la factura.*
>
> No se emitió nada, quedate tranqui.
> Cuando quieras arrancar de nuevo, escribime *"hola"* 👋

### `NC_CANCELACION`

> 👍 *Listo, descarté la nota de crédito.*
>
> No se emitió nada.
> Cuando quieras arrancar de nuevo, escribime *"hola"* 👋

### `CANC_CANCELACION` (el usuario decide NO cancelar el documento)

> 👍 *Perfecto, no cancelo nada.*
>
> El documento *sigue vigente*, tal como estaba ✅
> ¿Te ayudo con otra cosa?

---

## Notas de implementación

1. **Distinguir "cancelar el flujo" de "cancelar el documento"**: en la sección 5 se usó
   deliberadamente *"descarté"* para el abandono de borradores y se reservó *"cancelar"*
   para la anulación fiscal, evitando confusión en el flujo 4 donde ambas ideas conviven
   (el usuario puede "cancelar la cancelación").
2. **Separadores `━━━`**: WhatsApp no tiene líneas horizontales; el carácter de bloque
   funciona bien como divisor visual en las tarjetas de resumen. Mantener corto
   (~15 caracteres) para que no se corte en pantallas angostas.
3. **Cierre de conversación**: los mensajes finales de éxito (`CANC_EXITOSA`, captions de
   PDF) invitan al siguiente paso ("reenviala a tu cliente", "¿te ayudo con algo más?"),
   lo que refuerza la sensación de tarea completada.
4. **Consistencia con el catálogo de errores**: se mantiene el mismo set de campos con
   emoji (👤 🪪 📦 🔢 💰) tanto al *pedir* datos como al reportar que *faltan*, así el
   usuario ve siempre el mismo formulario mental.
5. **Ejemplo en `PEDIR_DATOS_FACTURA`**: mostrar un ejemplo concreto de mensaje válido
   reduce el ciclo de "campos faltantes" — considerar rotarlo o adaptarlo al rubro del
   emisor si más adelante se conoce.
