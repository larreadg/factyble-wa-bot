# Catálogo de mensajes al usuario en camino feliz

Inventario de todos los textos/mensajes que el bot le envía al usuario de WhatsApp en el
flujo normal (sin errores), agrupados por etapa. Complementa
[`mensajes-error-usuario.md`](./mensajes-error-usuario.md), que cubre las ramas de error.

Fuente: `src/utils/constants.js` (objeto `MENSAJES`), `src/services/botOrchestrator.service.js`,
`src/services/whatsapp.service.js`, `src/utils/facturaPresentacion.js`,
`src/utils/notaCreditoPresentacion.js`, `src/utils/cancelacionPresentacion.js`,
`src/services/documentoNotificacion.service.js`, `src/utils/documentoPresentacion.js`.

---

## 1. Entrada / menú principal

| Mensaje | Cuándo se envía | Código |
|---|---|---|
| Menú principal (list message interactivo): header "Factyble", body "Hola 😁 ¿Qué querés hacer?", 3 opciones (*Emitir factura* / *Nota de crédito* / *Cancelar documento*) | Saludo puro en contexto inicial (`operacionActiva == null`), `accion === 'FUERA_DE_ALCANCE'` en contexto inicial, `id` de interactivo desconocido, o mensaje entrante de tipo no soportado | `whatsappService.enviarMenuPrincipal` (`whatsapp.service.js:120-142`), invocado desde `enviarMenuPrincipalYRegistrar` (`botOrchestrator.service.js:111-131`) |
| `MENSAJE_BIENVENIDA`: "¡Bienvenido a Factyble! Podés enviarme en un solo mensaje el nombre y RUC o cédula del cliente, junto con los productos, cantidades y precios." | Saludo puro **cuando ya hay una operación activa** (`esContextoInicial === false`) — recuerda cómo seguir sin reiniciar el menú | `botOrchestrator.service.js:506, 557` |

> Nota: `MENSAJES.MENU_PRINCIPAL_LOG` ("[Menú principal] Hola 😁 ¿Qué querés hacer?") no es
> un mensaje que WhatsApp muestre — es solo el texto que se guarda en `Mensaje.contenidoTexto`
> para dejar registro legible del list message interactivo (que no tiene body de texto plano).

---

## 2. Flujo: Emitir factura

| Paso | Mensaje | Código |
|---|---|---|
| 1. Selección de "Emitir factura" en el menú | `PEDIR_DATOS_FACTURA`: "Contame los datos de la factura: nombre y RUC o cédula del cliente, y los productos o servicios con cantidad y precio." | `manejarInteractivo`, `botOrchestrator.service.js:923-927` |
| 2. Datos incompletos (puede repetirse varias veces) | `construirMensajeCamposFaltantes(...)` — dinámico: "Para preparar la factura todavía necesito:\n- `<campo>`.\n..." (o "Todavía no puedo emitir la factura: antes necesito..." si el usuario ya intentó confirmar); agrega advertencias `⚠️` si las hay | `facturaPresentacion.js:3-8`, usado en `procesarConParser` línea 617-621 |
| 3. Datos completos → resumen de confirmación | `construirResumenConfirmacion(borrador)` — dinámico: tarjeta con cliente, RUC/cédula, condición de venta, detalle de ítems (cantidad/precio/IVA/subtotal) y total general, cerrando con "¿Está todo correcto? 😊 / ✅ SÍ / ✏️ corrección / ❌ CANCELAR" | `facturaPresentacion.js:10-58`, usado en línea 634 |
| 4. Usuario confirma | `PROCESANDO_FACTURA`: "Tu factura está siendo emitida..." | línea 204 |
| 5. Emisión aceptada por la API de facturación → se entrega el **PDF en el acto** | Se envía el PDF como documento adjunto (la factura queda FIRMADA; el PDF ya está en disco al responder la API, no se espera la aprobación asíncrona de SIFEN), con caption `construirCaptionPdf(documento)`: "¡Factura aprobada! 🎉 · Factura nro. `<numeroDocumentoFormateado>`". El caption es el mensaje de éxito: no se envía además ningún texto | `entregarPdfAlCliente` (`botOrchestrator.service.js`), `documentoNotificacion.service.js` (`enviarPdf`), caption en `documentoPresentacion.js` |

---

## 3. Flujo: Nota de crédito

| Paso | Mensaje | Código |
|---|---|---|
| 1. Selección de "Nota de crédito" en el menú | `NC_PEDIR_CDC`: "Contame el CDC de la factura que querés acreditar: el código de 44 dígitos que figura en el KuDE, debajo del código QR." | `manejarInteractivo`, línea 929-935 |
| 2. CDC encontrado, se consultó el total de la factura original | `construirMensajeTotalEncontrado({ total, totalIva })` — dinámico: "✅ Encontré la factura. Total: `<monto>` (IVA `<monto>`). ¿Qué ítems querés acreditar?" | `notaCreditoPresentacion.js:7-8`, usado en línea 846 |
| 2b. Recordatorio (saludo/re-pregunta) mientras faltan ítems, con el total ya cargado | `NC_PEDIR_ITEMS`: "Contame qué ítems querés acreditar: descripción, cantidad y precio unitario de cada uno." | `mensajeRecordatorioNC`, línea 642 |
| 3. Ítems incompletos | `construirMensajeCamposFaltantes(...)` (mismo helper que factura) | línea 857-861 |
| 4. Todo completo → resumen de confirmación | `construirResumenConfirmacionNC(borrador)` — dinámico: tarjeta con CDC abreviado, total facturado, detalle de ítems a acreditar y total de la NC, cerrando con "¿Confirmás la emisión? 😊 / ✅ SÍ / ✏️ corrección / ❌ CANCELAR" | `notaCreditoPresentacion.js:13-52`, usado en línea 880 |
| 5. Usuario confirma | `NC_PROCESANDO`: "Tu nota de crédito está siendo emitida..." | línea 709 |
| 6. Emisión aceptada → se entrega el **PDF en el acto** | PDF adjunto con caption "¡Nota de crédito aprobada! 🎉 · Nota de crédito nro. `<numero>`" (mismo mecanismo que factura, sin esperar la aprobación asíncrona de SIFEN) | `entregarPdfAlCliente` (`botOrchestrator.service.js`), `documentoNotificacion.service.js` (`enviarPdf`) |

---

## 4. Flujo: Cancelar documento (factura o NC ya emitida)

| Paso | Mensaje | Código |
|---|---|---|
| 1. Selección de "Cancelar documento" en el menú (o detección determinística de intención de cancelar en contexto inicial) | `CANC_PEDIR_TIPO`: "¿Qué tipo de documento querés cancelar?\n1️⃣ Factura\n2️⃣ Nota de crédito" | `manejarInteractivo` línea 938-944; también `procesarCancelacion` línea 458-462 |
| 2. Tipo elegido, falta CDC | `CANC_PEDIR_CDC`: "Contame el CDC del documento que querés cancelar: el código de 44 dígitos que figura en el KuDE, debajo del código QR." | línea 466-470 |
| 3. Tipo + CDC completos → resumen de confirmación | `construirResumenConfirmacionCancelacion(borrador)` — dinámico: "⚠️ *Confirmación de cancelación* / Vas a cancelar la siguiente `<factura/nota de crédito>`: / CDC: `<abreviado>` / ... Esta acción es *irreversible* ... / ¿Confirmás la cancelación? (sí / no)" | `cancelacionPresentacion.js:5-16`, usado en línea 484 |
| 4. Usuario confirma (siempre en un turno aparte, ver nota abajo) | `CANC_PROCESANDO`: "Estoy procesando la cancelación del documento..." | línea 327 |
| 5. SIFEN confirma la cancelación (síncrono, se resuelve en la misma llamada) | `construirMensajeCancelacionExitosa({ cdc, estadoSifen })` — dinámico: "✅ *Documento cancelado* / CDC: `<abreviado>` / Estado SIFEN: `<estado>` / El documento quedó anulado y sin validez fiscal." | `cancelacionPresentacion.js:28-31`, usado en línea 376 |

> Nota de diseño (irreversibilidad): la confirmación del paso 3→4 exige un mensaje
> **separado** del que aportó tipo+CDC, incluso si la IA detecta `accion=CONFIRMAR` en el
> mismo mensaje — regla explícita para evitar cancelar por accidente (`procesarCancelacion`,
> comentario en línea 385-392).

---

## 5. Abandono voluntario de un flujo (el usuario decide no continuar — no es error)

| Mensaje | Flujo | Código |
|---|---|---|
| `CANCELACION`: "La emisión fue cancelada." | Factura, el usuario cancela antes de confirmar | `cancelar`, línea 183-190 |
| `NC_CANCELACION`: "La nota de crédito fue cancelada." | Nota de crédito | `cancelarNotaCredito`, línea 649-656 |
| `CANC_CANCELACION`: "Se descartó la cancelación del documento." | El usuario decide no cancelar el documento (aborta el sub-flujo de cancelación, el documento sigue vigente) | `abortarCancelacion`, línea 282-289 |

---

## Resumen visual del recorrido completo (factura, camino feliz)

```
Menú principal
   └─▶ "Emitir factura" (interactivo)
        └─▶ PEDIR_DATOS_FACTURA
             └─▶ (datos completos en 1+ mensajes)
                  └─▶ Resumen de confirmación
                       └─▶ "SÍ"
                            └─▶ PROCESANDO_FACTURA
                                 └─▶ (emisión aceptada) PDF + caption, en el acto
```

El mismo patrón (pedir datos → resumen → procesando → PDF en el acto) se repite para nota
de crédito, con un paso extra al principio (consulta de la factura original por CDC). El
PDF se entrega apenas la API de facturación acepta la emisión, sin esperar la aprobación
asíncrona de SIFEN. Cancelación de documento es más corta: no hay PDF, la confirmación de
SIFEN llega en la misma llamada.
