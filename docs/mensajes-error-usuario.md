# Catálogo de mensajes al usuario en escenarios de error

Inventario de todos los textos que el bot le envía al usuario de WhatsApp cuando algo
sale mal (o no puede resolverse en el momento), agrupados por flujo. No incluye los
mensajes de "camino feliz" (bienvenida, resúmenes de confirmación, etc.) salvo cuando
forman parte de una rama de error/edge-case.

Fuente: `src/utils/constants.js` (objeto `MENSAJES`), `src/services/botOrchestrator.service.js`,
`src/utils/cancelacionPresentacion.js`.

> Convención de columnas: **Disparador** = qué condición lo produce · **Código** = dónde
> vive en el repo · **¿Corregible por el usuario?** = si la sesión vuelve a un estado
> donde puede reintentar, o si la operación se corta ahí.

---

## 1. Interpretación de mensajes con IA (OpenAI) — genérico, aplica a factura, NC y cancelación

| Mensaje | Disparador | Código | ¿Corregible? |
|---|---|---|---|
| `OPENAI_NO_DISPONIBLE`: "No pude interpretar el mensaje en este momento. Podés intentar nuevamente en unos instantes." | Falla el parser de OpenAI con `TIMEOUT`, `RATE_LIMIT`, `CONNECTION`, `AUTH` o `UNKNOWN` | `mapOpenAIErrorAMensaje` (botOrchestrator.service.js:69) | Sí, sesión no cambia de estado |
| `NO_SE_PUDO_INTERPRETAR`: "No pude identificar con seguridad todos los datos. Indicame el nombre y RUC o cédula del cliente, además de cada producto, cantidad y precio unitario." | El parser de factura respondió pero con un error de tipo distinto a los de arriba (ej. `PARSE_ERROR`, salida no interpretable) | `mapOpenAIErrorAMensaje` | Sí |

Usado en los tres puntos de entrada por texto: `procesarConParser` (factura),
`procesarNotaCredito`, `procesarCancelacion`.

---

## 2. Emisión de factura (`confirmarYEmitir`, botOrchestrator.service.js:192)

| Mensaje | Disparador | Código | ¿Corregible? |
|---|---|---|---|
| `YA_PROCESANDO`: "La factura ya está siendo procesada. Te enviaré el documento cuando esté disponible." | Confirmación concurrente (doble tap / doble mensaje) mientras ya está en `PROCESANDO` | línea 200 y también `manejarSesion` línea 897 | N/A, no es error real |
| Mensaje dinámico `construirMensajeDatosRechazados(error.message)`: "No pudimos emitir la factura: la API de facturación rechazó algunos datos (`<detalle del backend>`). Revisá los datos, indicá la corrección que haga falta y volvé a confirmar." | `POST /factura/simple` devuelve **400** (`FacturaApiError` tipo `VALIDATION`) — ej. RUC inválido para SIFEN | línea 164 y 223 | **Sí** — sesión vuelve a `ESPERANDO_CONFIRMACION` con el borrador intacto |
| `ERROR_EMISION`: "No pudimos completar la emisión. La operación quedó registrada para evitar una emisión duplicada." | Cualquier otro error: `401` tras reintento de auth, `404`, `500`, `TIMEOUT`, `NETWORK` | línea 230 | No — sesión pasa a `ERROR`, se corta el flujo |

**Nota:** el `401` (token vencido) no le llega al usuario como error — `facturaEmisionService.emitirFactura`
reautentica una vez y reintenta en silencio (`facturaEmision.service.js:36-46`); solo si el segundo intento
también falla, cae en alguna de las dos filas de arriba.

---

## 3. Nota de crédito

### 3.1 Consulta de total de factura (`procesarNotaCredito`, paso 2, línea 819)

| Mensaje | Disparador | Código | ¿Corregible? |
|---|---|---|---|
| `NC_CDC_NO_ENCONTRADO`: "No encontré ninguna factura con ese CDC en tu empresa. Verificá que el código esté completo y que la factura haya sido emitida desde esta cuenta." | `GET /factura/cdc/:cdc/total` → `404` | línea 830 | Sí — se limpia el CDC, vuelve a pedirlo |
| `NC_CDC_INVALIDO`: "El CDC debe tener exactamente 44 dígitos numéricos..." | `GET /factura/cdc/:cdc/total` → `400` (`VALIDATION`, formato de CDC) | línea 830 | Sí |
| `NC_CONSULTA_NO_DISPONIBLE`: "No pude consultar la factura en este momento. Probá de nuevo en unos instantes." | Cualquier otro error de la consulta (timeout, red, 500) | línea 837 | Sí, pero sin resetear el CDC |

### 3.2 Control de monto antes de confirmar (línea 866)

| Mensaje | Disparador | Código |
|---|---|---|
| `construirMensajeMontoExcedeTotal(totalAcreditar, totalFactura)` — dinámico, ver `notaCreditoPresentacion.js` | El total a acreditar supera el saldo de la factura original | línea 869 |

### 3.3 Emisión (`confirmarYEmitirNotaCredito`, línea 700, mapeado por `mapNotaCreditoEmisionError`, línea 667)

| Mensaje | Disparador | ¿Corregible? |
|---|---|---|
| `NC_YA_PROCESANDO`: "La nota de crédito ya está siendo procesada. Te aviso cuando esté disponible." | Confirmación concurrente | N/A |
| `NC_CONFIG_FALTANTE`: "Falta configuración en tu empresa (establecimiento/caja). Contactá al administrador para completarla antes de emitir notas de crédito." | `404` con mensaje que menciona "establecimiento"/"caja" | Sí, vuelve a confirmación (aunque requiere intervención externa) |
| `NC_CDC_NO_ENCONTRADO` (reutilizado) | `404` sin mención a establecimiento/caja | Sí — resetea CDC |
| `NC_FACTURA_CANCELADA`: "Esa factura está cancelada, no se pueden emitir notas de crédito sobre ella." | `400` con mensaje que contiene "cancelada" | No — resetea CDC pero no vuelve a confirmación (corta ese intento) |
| `NC_FACTURA_NO_APROBADA`: "La factura todavía no fue aprobada por SIFEN. Hay que esperar la aprobación antes de acreditarla. Probá de nuevo en unos minutos." | `400` con "no se ha aprobado" / "aún no" | Resetea CDC |
| `NC_SALDO_INSUFICIENTE`: "⚠️ No se pudo emitir: ya existen notas de crédito anteriores sobre esta factura y, sumadas a esta, superan el total facturado..." | `400` con "supera el valor total" / "supera" | Sí, vuelve a confirmación |
| Mensaje dinámico genérico: `` `No se pudo emitir la nota de crédito: ${msg}. Indicame la corrección que haga falta.` `` | `400` (`VALIDATION`) que no matchea ninguno de los casos anteriores | Sí, vuelve a confirmación |
| `NC_ERROR_EMISION`: "No pudimos completar la emisión de la nota de crédito. La operación quedó registrada para evitar una emisión duplicada." | Error que no es `FacturaApiError`, o cualquier tipo no cubierto arriba (500, timeout, red) | No — sesión pasa a `ERROR` |

---

## 4. Cancelación de documento (factura o NC ya emitida)

### 4.1 Validación de CDC / flujo (`procesarCancelacion`, línea 393)

| Mensaje | Disparador |
|---|---|
| `CANC_CDC_INVALIDO`: "El CDC debe tener exactamente 44 dígitos numéricos..." | El usuario mandó un CDC con formato inválido (extracción local, no llamada a API) |

### 4.2 Llamada a cancelar (`confirmarYCancelarDocumento`, línea 318, mapeado por `mapCancelacionError`, línea 296)

| Mensaje | Disparador | ¿Corregible? |
|---|---|---|
| `CANC_YA_PROCESANDO`: "La cancelación ya está siendo procesada. Te aviso en cuanto tenga novedades." | Confirmación concurrente | N/A |
| `construirMensajeSugerirTipoAlternativo(borrador)` — dinámico: "No encontré ninguna `<factura/nota de crédito>` con ese CDC en tu empresa. ¿Puede ser que sea una `<tipo alternativo>`?..." | `404` y aún no se ofreció el tipo alternativo (`intentoAlternativoUsado` false) | Sí — pregunta si reintentar con el otro tipo |
| `CANC_CDC_NO_CORRESPONDE`: "Ese CDC no corresponde a ningún documento de tu empresa. Verificalo e intentá de nuevo." | `404` y **ya** se había probado el tipo alternativo | No — sesión termina en `CANCELADA` (se aborta el sub-flujo) |
| `CANC_YA_CANCELADO`: "Ese documento ya está cancelado, no hay nada más que hacer. ✅" | `400` con mensaje que contiene "cancelad" | Se trata como éxito (`terminarOk`), sesión → `COMPLETADA` |
| `construirMensajeNotaCreditoVinculadas(msg)` — dinámico: "No se puede cancelar esta factura porque tiene `<N>` nota(s) de crédito aprobada(s) vinculada(s)..." | `400`, tipo `FACTURA`, mensaje contiene "nota" + "aprobada" | No — sesión → `ERROR` |
| `construirMensajeEstadoNoAprobado(msg)` — dinámico: "El documento no se puede cancelar porque no está aprobado (estado actual: `<X>`)..." | `400` con mensaje que contiene "aprobado" | No — sesión → `ERROR` |
| `CANC_SIN_CAJA`: "Hay una inconsistencia de configuración con este documento (sin caja asignada). Contactá al administrador para resolverla." | `400` con mensaje que contiene "caja" | No — sesión → `ERROR` |
| `CANC_CDC_FORMATO_INVALIDO`: "El CDC no tiene el formato correcto (debe ser 44 dígitos). ¿Podés verificarlo y enviármelo de nuevo?" | `400` (`VALIDATION`) que no matchea ninguno de los casos anteriores | Sí — resetea CDC, vuelve a `CAPTURANDO_DATOS` |
| `CANC_ERROR`: "No pude comunicarme con SIFEN para procesar la cancelación. El documento NO fue cancelado. Intentá de nuevo en unos minutos; si persiste, contactá al soporte." | Cualquier error que no sea `FacturaApiError` tipo `VALIDATION`/`NOT_FOUND` (timeout, red, 500, 401 sin resolver) | No — sesión → `ERROR` |
| `construirMensajeRechazoSifen(resultado)` — dinámico: "⚠️ SIFEN rechazó la cancelación. El documento sigue en estado `<estado>`. Motivo: `<mensaje>` (código `<código>`)." + sugerencia de NC si el motivo menciona "plazo"/"vencid" | La llamada devolvió `200` pero `estadoSifen !== 'CANCELADO'` (SIFEN rechazó el evento) | No — sesión → `ERROR` (regla explícita: 200 no implica cancelado) |

---

## 4.3 Falla al entregar el PDF tras emitir (`entregarPdfAlCliente`, `botOrchestrator.service.js`)

El PDF se entrega de forma **síncrona** apenas la API de facturación acepta la emisión (ver
[`mensajes-camino-feliz.md`](./mensajes-camino-feliz.md), paso 5/6): ya no hay notificación
asíncrona posterior. La descarga del PDF + su subida a WhatsApp puede fallar, pero la
factura/NC ya quedó emitida (irreversible), así que la sesión igual llega a `COMPLETADA` y
solo se avisa por texto. **No hay reintento automático** (se eliminó el barrido asíncrono).

| Mensaje | Disparador | Código |
|---|---|---|
| `FACTURA_EMITIDA_SIN_PDF`: "✅ ¡Tu factura fue emitida correctamente! Sin embargo, no pude adjuntarte el PDF por este chat en este momento. Contactá a soporte (wa.me/595976788698) para que te lo hagan llegar." | `documentoNotificacionService.enviarPdf` lanza (descarga fallida, `pdfNombre` null, o WhatsApp caído) al emitir una factura | `entregarPdfAlCliente` (`botOrchestrator.service.js`) |
| `NC_EMITIDA_SIN_PDF`: mismo texto para nota de crédito | Ídem, al emitir una nota de crédito | `entregarPdfAlCliente` (`botOrchestrator.service.js`) |

**Nota:** el estado final que SIFEN le asigne al documento (APROBADO/RECHAZADO/ERROR) se sigue
registrando en la tabla `documento` vía `POST /documento/bulk-update` (para auditoría), pero
**ya no dispara ningún aviso al cliente**.

---

## 5. Mensajes multimedia (audio, tipos no soportados)

| Mensaje | Disparador | Código |
|---|---|---|
| `AUDIO_NO_DISPONIBLE`: "No pude descargar el audio que enviaste. Probá reenviarlo o escribime el mensaje en texto." | Falta `audio.id` en el webhook, o falla `whatsappService.downloadMedia` | botOrchestrator.service.js:962, 972 |
| `AUDIO_NO_TRANSCRIBIBLE`: "No pude entender el audio que enviaste. Probá grabarlo de nuevo o escribime el mensaje en texto." | Falla la transcripción de OpenAI con tipo no infraestructural (ver `mapTranscripcionErrorAMensaje`) | línea 79-87 |
| `AUDIO_SIN_TEXTO`: "No detecté contenido hablado en el audio. Probá grabarlo de nuevo o escribime el mensaje en texto." | La transcripción devolvió vacío/whitespace | línea 1005 |
| `OPENAI_NO_DISPONIBLE` (reutilizado) | Falla de transcripción por `TIMEOUT`/`RATE_LIMIT`/`CONNECTION`/`AUTH`/`UNKNOWN` | línea 79-87 |
| `SOLO_TEXTO_SOPORTADO`: "Por el momento solo puedo procesar mensajes de texto para emitir facturas." | Mensaje entrante de tipo `image`/`document`/otro no texto/audio | línea 1093 (seguido de reenvío del menú principal) |
| `FUERA_DE_ALCANCE`: "Por ahora puedo ayudarte a preparar y emitir facturas electrónicas." | La IA clasifica el mensaje como fuera de alcance (en cualquiera de los 3 parsers) | usado en `procesarConParser`, `procesarNotaCredito`, `procesarCancelacion` |

---

## 6. Correcciones / entendimiento ambiguo (no son errores de sistema, pero son "algo salió mal en la interpretación")

| Mensaje | Disparador |
|---|---|
| `CORRECCION_NO_ENTENDIDA`: "No entendí bien esa corrección, así que dejé la factura sin cambios. ¿Podés indicar puntualmente qué dato querés cambiar (cliente, producto, cantidad, precio o condición de venta)?" | El borrador reconstruido es idéntico al anterior tras un mensaje que no fue clasificado como `CONFIRMAR` (factura y NC) |
| Mensaje ad-hoc (no está en `MENSAJES`): "¿Querés anular completamente el documento (pierde validez fiscal ante SIFEN) o generar una nota de crédito parcial sobre una factura que sigue vigente? Contame cuál de las dos necesitás." | `detectarIntentoCancelacionDocumento` detecta intención ambigua entre cancelar y nota de crédito parcial, en contexto inicial | botOrchestrator.service.js:521 (literal inline, **no está en `constants.js`**) |

---

## 7. Fallos de infraestructura propia (no de la API de facturación)

| Comportamiento | Disparador | Código |
|---|---|---|
| No hay mensaje al usuario; se loguea `'Error enviando mensaje saliente de WhatsApp'` y el registro del mensaje queda con `estado: 'FALLIDO'` | `whatsappService.sendTextMessage` falla (ej. token de Meta vencido, rate limit, número inválido) | `responderYRegistrar`, línea 89-109 |
| Best-effort silencioso, no afecta la respuesta al usuario | Falla `documentoService.registrarEmision` al persistir el documento ya emitido/firmado | `registrarDocumentoEmitido`, línea 156-162 |
| Fire-and-forget, nunca se propaga | Falla `chatExportService.exportar` (envío del resumen del chat a Telegram) | `notificarFinDeChat`, línea 177-181 (el propio servicio atrapa sus errores) |

**Importante:** si falla el envío del mensaje de error al propio usuario (ej. Meta caído
en simultáneo con el error de negocio), el usuario no recibe *ningún* aviso — solo queda
el log y el `Mensaje` en la tabla marcado `FALLIDO`. No hay reintento automático de envío.

---

## Resumen de textos "genéricos" candidatos a revisar primero

Estos son los mensajes que cubren *el mayor número de causas distintas* bajo un mismo
texto (más propensos a ser poco informativos para el usuario o el soporte):

1. `ERROR_EMISION` / `NC_ERROR_EMISION` / `CANC_ERROR` — cubren timeout, red, 500 y 401
   post-reintento con el mismo texto genérico.
2. `NC_CONSULTA_NO_DISPONIBLE` — igual, cualquier fallo no-400/404 al consultar el total.
3. `OPENAI_NO_DISPONIBLE` — agrupa 5 tipos de error de OpenAI (`TIMEOUT`, `RATE_LIMIT`,
   `CONNECTION`, `AUTH`, `UNKNOWN`) bajo el mismo mensaje.
4. El mensaje ambiguo de la sección 6 vive hardcodeado inline en `botOrchestrator.service.js`
   en vez de estar en `MENSAJES` (inconsistente con el resto).
