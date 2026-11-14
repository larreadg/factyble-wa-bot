const { z } = require('zod');
const { zodTextFormat } = require('openai/helpers/zod');
const openaiService = require('./openai.service');
const { OpenAIServiceError } = require('./openai.errors');
const { ClienteSchema, TASAS_IVA, MAX_ITEMS } = require('./facturaParser.service');
const { formatearGuaranies } = require('../utils/moneda');
const env = require('../utils/env');
const logger = require('../utils/logger');

// Extractor de facturas a partir de una FOTO de un comprobante físico (preimpreso, impreso o
// escrito a mano). Es un módulo aparte del parser conversacional (facturaParser.service.js) a
// propósito: leer el formato de una factura (columnas de IVA, casillas de contado/crédito,
// encabezado del emisor vs. datos del cliente) es un problema distinto a interpretar lenguaje
// natural, y mezclarlos en un mismo prompt pondría en riesgo el comportamiento ya afinado del
// parser de texto. La salida se normaliza acá (normalizarExtraccion) a la misma forma `factura`
// que devuelve el parser, así que desde ahí en adelante el flujo es el de siempre
// (construirBorrador → campos faltantes / resumen → confirmación explícita → emisión).

const REINTENTO_BACKOFF_MS = 300;

// Subir este número (y el texto de abajo) cada vez que cambien las reglas del prompt.
const FACTURA_IMAGEN_PROMPT_VERSION = 1;

// Formatos que acepta la Responses API como input_image y que WhatsApp puede mandar (como
// imagen, o como documento cuando el usuario la envía "sin compresión").
const MIME_IMAGEN_SOPORTADOS = ['image/jpeg', 'image/png', 'image/webp'];

// WhatsApp limita las imágenes a 5 MB, pero un documento puede pesar mucho más: se corta antes
// de mandarlo a OpenAI (en base64 crece ~33%).
const MAX_IMAGEN_BYTES = 10 * 1024 * 1024;

const MAX_LEYENDA_LEN = 1000;

const baseMime = (mimeType) => (mimeType || '').split(';')[0].trim().toLowerCase();
const esMimeImagenSoportado = (mimeType) => MIME_IMAGEN_SOPORTADOS.includes(baseMime(mimeType));

const ItemImagenSchema = z
  .object({
    descripcion: z.string().trim().min(1).max(200),
    cantidad: z.number().finite().gt(0).nullable(),
    precioUnitario: z.number().finite().gte(0).nullable(),
    // Monto total de la línea tal como figura en la factura (columna Exentas/5%/10%). No se
    // factura con este valor: sirve para completar el precio/cantidad faltante y para
    // detectar lecturas erróneas (cantidad × precio ≠ importe).
    importeLinea: z.number().finite().gte(0).nullable(),
    tasa: z.enum(TASAS_IVA),
  })
  .strict();

const SalidaImagenSchema = z
  .object({
    esComprobanteDeVenta: z.boolean(),
    cliente: ClienteSchema,
    condicionVenta: z.enum(['CONTADO', 'CREDITO']),
    plazoCredito: z.string().trim().max(100).nullable(),
    items: z.array(ItemImagenSchema).max(MAX_ITEMS),
    // "Total a pagar" impreso/escrito en la factura, solo para control cruzado.
    totalImpreso: z.number().finite().gte(0).nullable(),
    advertencias: z.array(z.string().max(300)).max(20),
  })
  .strict();

// Prompt estático: los datos variables (emisor, leyenda) van solo en el mensaje de rol "user"
// para aprovechar el prefix-cache de OpenAI.
const INSTRUCCIONES_ESTATICAS = `Sos el módulo de lectura de imágenes de Factyble, un bot de WhatsApp para emitir facturas electrónicas en Paraguay.

Recibís la FOTO de un comprobante de venta físico (factura preimpresa de talonario, ticket, nota de venta o pedido; puede estar impreso o escrito a mano, torcido, con sombras o con partes borrosas). Con esos datos el usuario va a emitir una factura electrónica NUEVA, con fecha de hoy y con los datos fiscales de su empresa, que ya están configurados. Por eso lo único que necesitás extraer es: QUIÉN es el cliente y QUÉ se le vendió.

NO controlás el flujo, NO calculás totales ni el IVA, NO emitís nada: el backend valida y le muestra un resumen al usuario para que confirme.

Qué IGNORAR siempre:
- Todo el encabezado del EMISOR: razón social, nombre de fantasía, RUC del emisor, actividad, dirección, teléfono, timbrado, vigencia, número de factura, sucursal.
- La fecha del comprobante.
- La liquidación del IVA, los subtotales por tasa, el total en letras ("Son guaraníes..."), firmas, sellos y leyendas legales ("Original: cliente", etc.).
- Te paso los datos del emisor en el mensaje: si un nombre o RUC coincide con el emisor, NUNCA lo uses como cliente.

Cliente (campo "cliente"):
- Está en la sección del cliente/receptor ("Nombre o razón social", "Señor(es)", "Cliente", "RUC/C.I. N°").
- nombre: tal como está escrito. null si no aparece o no se lee.
- numeroDocumento y tipoDocumento:
  - Con formato número-guion-dígito verificador (ej. "80012345-6", "4567890-1") -> tipoDocumento="RUC", numeroDocumento con el guion.
  - Sin guion ni dígito verificador (ej. "4567890" o "4.567.890") -> tipoDocumento="CI", numeroDocumento solo con los dígitos.
  - Si no aparece o no se lee con seguridad -> ambos null. Si algún dígito es dudoso, NO lo adivines: dejá null y agregá una advertencia.

Condición de venta:
- "CREDITO" solo si la casilla/palabra "Crédito" está marcada o escrita como la condición elegida. En cualquier otro caso (Contado marcado, nada marcado) -> "CONTADO".
- plazoCredito: solo si es crédito y figura un plazo o vencimiento ("30 días", "Vence 15/12") tal como está escrito; si no, null.

Ítems (detalle de la venta), uno por cada línea con contenido:
- descripcion: el producto o servicio tal como está escrito (podés corregir errores de ortografía evidentes, no cambies el producto).
- cantidad: la columna de cantidad. null si está vacía o no se lee.
- precioUnitario: el precio unitario. null si está vacío o no se lee.
- importeLinea: el monto total de esa línea (el que está en la columna de valor de venta). null si no se lee.
- tasa: según la columna en la que está el importe de la línea: "Exentas" -> "0%", "5%" -> "5%", "10%" -> "10%". Si el comprobante no tiene columnas de IVA, o no se distingue la columna, usá "10%".
- Ignorá líneas vacías, tachadas, de subtotal o de "transporte/van". Si hay un descuento o recargo en una línea aparte, no lo agregues como ítem: mencionalo en una advertencia.
- Si hay más de ${MAX_ITEMS} líneas, devolvé las primeras ${MAX_ITEMS} y agregá una advertencia.
- No calcules valores que no están escritos (el backend completa lo que se puede deducir): si un dato no figura, va null.

Números (formato paraguayo):
- El punto separa miles y la coma separa decimales: "150.000" = 150000, "1.500.000" = 1500000, "2,5" = 2.5.
- Los montos en guaraníes no tienen decimales. Las cantidades sí pueden tenerlos (ej. "1,5" kg).
- Ignorá símbolos de moneda ("Gs.", "₲").
- En números escritos a mano, si un dígito es ambiguo (1/7, 3/8, 5/6, 0/6...) y no podés decidirlo con seguridad, dejá ese campo en null y explicá cuál en una advertencia. Es preferible pedirle el dato al usuario a emitir un monto equivocado.

totalImpreso: el total general a pagar escrito en el comprobante (en números). null si no figura o no se lee.

Leyenda del usuario:
- Si el mensaje trae un texto que el usuario mandó junto con la foto, ese texto tiene PRIORIDAD sobre la imagen para los datos que mencione (ej. "es a crédito 30 días", "el RUC es 80012345-6", "sin el último ítem").

esComprobanteDeVenta:
- false si la imagen no es un comprobante, factura, ticket, nota de venta o pedido (ej. una foto de una persona, un paisaje, una captura sin datos de venta). En ese caso devolvé cliente con todo null, items=[], totalImpreso=null.

advertencias: frases cortas en español de Paraguay (voseo), dirigidas al usuario, solo sobre datos dudosos o ilegibles que tenga que revisar (ej. "No se lee bien la cantidad de \\"Cemento\\""). Lista vacía si todo se lee bien. No repitas lo que falta por estar vacío en el comprobante.`;

const buildUserContent = ({ base64, mimeType, leyenda, emisor }) => {
  const lineas = [
    `Datos del emisor (NO son el cliente): razón social="${emisor?.razonSocial || 'desconocida'}", RUC="${emisor?.ruc || 'desconocido'}".`,
  ];

  if (leyenda) {
    lineas.push('', 'Texto que el usuario mandó junto con la foto:', '"""', leyenda, '"""');
  } else {
    lineas.push('', 'El usuario no mandó texto junto con la foto.');
  }

  return [
    { type: 'input_text', text: lineas.join('\n') },
    // detail "high": hace falta para números chicos y escritura a mano.
    { type: 'input_image', image_url: `data:${baseMime(mimeType)};base64,${base64}`, detail: 'high' },
  ];
};

const isTransient = (err) => {
  const status = err?.status;
  if (err?.name === 'APIConnectionTimeoutError' || err?.name === 'APIConnectionError') return true;
  if (status === 429) return true;
  if (typeof status === 'number' && status >= 500 && status < 600) return true;
  return false;
};

const extractRefusal = (response) => {
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'refusal') return content.refusal || true;
    }
  }
  return null;
};

const mapError = (err) => {
  if (err instanceof OpenAIServiceError) return err;

  const status = err?.status;
  if (err?.name === 'APIConnectionTimeoutError') return new OpenAIServiceError('TIMEOUT', 'Timeout al llamar a OpenAI', err);
  if (status === 429) return new OpenAIServiceError('RATE_LIMIT', 'Rate limit de OpenAI', err);
  if (status === 401 || status === 403) return new OpenAIServiceError('AUTH', 'Error de autenticación con OpenAI', err);
  if (err?.name === 'APIConnectionError') return new OpenAIServiceError('CONNECTION', 'Error de conexión con OpenAI', err);

  return new OpenAIServiceError('UNKNOWN', 'Error inesperado al llamar a OpenAI', err);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const logUsage = (response) => {
  const usage = response?.usage;
  if (!usage) return;

  logger.info('OpenAI usage', {
    model: env.OPENAI_VISION_MODEL,
    promptVersion: FACTURA_IMAGEN_PROMPT_VERSION,
    modulo: 'factura-imagen',
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0,
  });
};

const buildRequestParams = ({ base64, mimeType, leyenda, emisor }) => {
  const params = {
    model: env.OPENAI_VISION_MODEL,
    input: [
      { role: 'developer', content: INSTRUCCIONES_ESTATICAS },
      { role: 'user', content: buildUserContent({ base64, mimeType, leyenda, emisor }) },
    ],
    text: { format: zodTextFormat(SalidaImagenSchema, 'factura_imagen_output') },
    max_output_tokens: env.OPENAI_VISION_MAX_OUTPUT_TOKENS,
    prompt_cache_key: `${env.OPENAI_PROMPT_CACHE_KEY}:factura-imagen`,
    store: false,
  };

  if (env.OPENAI_REASONING_EFFORT) {
    params.reasoning = { effort: env.OPENAI_REASONING_EFFORT };
  }

  return params;
};

// Llama al modelo con la imagen y devuelve la salida cruda validada por Zod (sin normalizar).
const interpretarImagen = async ({ buffer, mimeType, leyenda, emisor }) => {
  if (!buffer || !buffer.length) {
    throw new OpenAIServiceError('INVALID_INPUT', 'Imagen vacía');
  }
  if (!esMimeImagenSoportado(mimeType)) {
    throw new OpenAIServiceError('INVALID_INPUT', `Formato de imagen no soportado: ${mimeType}`);
  }
  if (buffer.length > MAX_IMAGEN_BYTES) {
    throw new OpenAIServiceError('INVALID_INPUT', 'Imagen demasiado grande');
  }

  const leyendaLimitada = typeof leyenda === 'string' && leyenda.trim() ? leyenda.trim().slice(0, MAX_LEYENDA_LEN) : null;
  const client = openaiService.getClient();
  const params = buildRequestParams({ base64: buffer.toString('base64'), mimeType, leyenda: leyendaLimitada, emisor });

  const ejecutar = () => client.responses.parse(params, { timeout: env.OPENAI_VISION_TIMEOUT_MS });

  let response;
  try {
    response = await ejecutar();
  } catch (err) {
    if (isTransient(err)) {
      await sleep(REINTENTO_BACKOFF_MS);
      try {
        response = await ejecutar();
      } catch (err2) {
        throw mapError(err2);
      }
    } else {
      throw mapError(err);
    }
  }

  logUsage(response);

  if (response.output_parsed == null) {
    if (extractRefusal(response)) {
      throw new OpenAIServiceError('REFUSAL', 'El modelo rechazó interpretar la imagen');
    }
    if (response.status === 'incomplete') {
      throw new OpenAIServiceError('INCOMPLETE', 'Respuesta incompleta de OpenAI');
    }
    throw new OpenAIServiceError('EMPTY_RESPONSE', 'OpenAI no devolvió una salida estructurada');
  }

  const parsed = SalidaImagenSchema.safeParse(response.output_parsed);
  if (!parsed.success) {
    logger.error('Salida de OpenAI (imagen) no cumple el esquema esperado', parsed.error.issues);
    throw new OpenAIServiceError('INVALID_OUTPUT', 'La salida de OpenAI no cumple el esquema esperado');
  }

  return parsed.data;
};

// Tolerancia en guaraníes para comparar montos calculados vs. impresos: absorbe redondeos de
// cantidades decimales, no errores de lectura (que en la práctica difieren en miles).
const TOLERANCIA_LINEA_GS = 1;

const soloDigitosBase = (documento) => (documento || '').split('-')[0].replace(/\D+/g, '');
const normalizarComparable = (texto) => (texto || '').trim().toLowerCase().replace(/\s+/g, ' ');

// Completa lo que se puede deducir sin adivinar a partir del importe de la línea: el modelo
// tiene prohibido calcular, así que estas deducciones son determinísticas y quedan acá.
const completarItem = (item) => {
  let { cantidad, precioUnitario } = item;
  const { importeLinea } = item;

  if (importeLinea != null) {
    if (cantidad == null && precioUnitario == null) {
      // Línea con solo descripción + monto (típico de servicios): una unidad por el importe.
      cantidad = 1;
      precioUnitario = importeLinea;
    } else if (precioUnitario == null && cantidad != null) {
      // Exacto: un precio que "casi" da (1000 / 3 -> 333) dejaría el total de la factura
      // electrónica distinto del físico; mejor pedírselo al usuario.
      const precio = Math.round(importeLinea / cantidad);
      if (Math.round(precio * cantidad) === importeLinea) precioUnitario = precio;
    } else if (cantidad == null && precioUnitario > 0) {
      const cant = Math.round((importeLinea / precioUnitario) * 1000) / 1000;
      if (cant > 0 && Math.abs(cant * precioUnitario - importeLinea) <= TOLERANCIA_LINEA_GS) cantidad = cant;
    }
  }

  return { descripcion: item.descripcion, cantidad, precioUnitario, importeLinea, tasa: item.tasa };
};

/**
 * Convierte la salida del modelo en la forma `factura` que entiende construirBorrador, aplicando
 * los controles determinísticos que hacen de red contra errores de lectura:
 * - cantidad × precio vs. importe de cada línea,
 * - suma de los ítems vs. total impreso,
 * - el RUC/razón social del emisor nunca se toma como cliente.
 * Las discrepancias no bloquean: se agregan como advertencias, que el usuario ve en el resumen
 * antes de confirmar.
 */
const normalizarExtraccion = (salida, { emisor } = {}) => {
  const advertencias = [...(salida.advertencias || [])];
  const cliente = { ...salida.cliente };

  const docEmisor = soloDigitosBase(emisor?.ruc);
  if (docEmisor && cliente.numeroDocumento && soloDigitosBase(cliente.numeroDocumento) === docEmisor) {
    cliente.tipoDocumento = null;
    cliente.numeroDocumento = null;
    advertencias.push('El RUC que figura en la foto es el de tu empresa, no el del cliente');
  }
  if (emisor?.razonSocial && cliente.nombre && normalizarComparable(cliente.nombre) === normalizarComparable(emisor.razonSocial)) {
    cliente.nombre = null;
    advertencias.push('El nombre que figura en la foto es el de tu empresa, no el del cliente');
  }

  const itemsCompletos = (salida.items || []).map(completarItem);

  for (const item of itemsCompletos) {
    if (item.cantidad == null || item.precioUnitario == null || item.importeLinea == null) continue;
    const calculado = Math.round(item.cantidad * item.precioUnitario);
    if (Math.abs(calculado - item.importeLinea) > TOLERANCIA_LINEA_GS) {
      advertencias.push(
        `En "${item.descripcion}", ${item.cantidad} × ${formatearGuaranies(item.precioUnitario)} da ${formatearGuaranies(calculado)}, pero en la factura figura ${formatearGuaranies(item.importeLinea)}: revisá la cantidad y el precio`,
      );
    }
  }

  const todosCompletos = itemsCompletos.length > 0 && itemsCompletos.every((item) => item.cantidad != null && item.precioUnitario != null);
  if (salida.totalImpreso != null && todosCompletos) {
    const suma = itemsCompletos.reduce((acc, item) => acc + Math.round(item.cantidad * item.precioUnitario), 0);
    if (Math.abs(suma - salida.totalImpreso) > Math.max(TOLERANCIA_LINEA_GS, itemsCompletos.length)) {
      advertencias.push(
        `La suma de los productos (${formatearGuaranies(suma)}) no coincide con el total de la factura (${formatearGuaranies(salida.totalImpreso)}): puede que algún monto se haya leído mal o que falte alguna línea`,
      );
    }
  }

  const factura = {
    cliente,
    condicionVenta: salida.condicionVenta,
    plazoCredito: salida.plazoCredito,
    items: itemsCompletos.map(({ descripcion, cantidad, precioUnitario, tasa }) => ({ descripcion, cantidad, precioUnitario, tasa })),
  };

  const vacia = !cliente.nombre && !cliente.numeroDocumento && factura.items.length === 0;

  return { factura, advertencias: advertencias.slice(0, 20), vacia };
};

module.exports = {
  interpretarImagen,
  normalizarExtraccion,
  esMimeImagenSoportado,
  SalidaImagenSchema,
  FACTURA_IMAGEN_PROMPT_VERSION,
  MAX_IMAGEN_BYTES,
};
