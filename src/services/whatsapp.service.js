const crypto = require('crypto');
const env = require('../utils/env');
const logger = require('../utils/logger');
const { MENU_IDS } = require('../utils/constants');

const GRAPH_BASE_URL = 'https://graph.facebook.com';

// Límites de la API de WhatsApp Cloud para interactive list messages.
const LIST_MESSAGE_LIMITS = { TITLE_MAX: 24, DESCRIPTION_MAX: 72, MAX_ROWS: 10 };

const sendTextMessage = async (to, body) => {
  const url = `${GRAPH_BASE_URL}/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    logger.error('Error enviando mensaje de WhatsApp', res.status, errorBody);
    throw new Error(`WhatsApp API error: ${res.status}`);
  }

  return res.json();
};

const sendDocumentMessage = async (to, { link, id, filename, caption }) => {
  const url = `${GRAPH_BASE_URL}/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const document = id ? { id, filename, caption } : { link, filename, caption };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'document',
      document,
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    logger.error('Error enviando documento de WhatsApp', res.status, errorBody);
    throw new Error(`WhatsApp API error: ${res.status}`);
  }

  return res.json();
};

// Valida los límites documentados por Meta para list messages antes de enviar, para
// fallar con un error claro en vez de que la API rechace el mensaje en silencio.
const validarListMessageSections = (sections) => {
  const totalRows = sections.reduce((total, section) => total + section.rows.length, 0);

  if (totalRows > LIST_MESSAGE_LIMITS.MAX_ROWS) {
    throw new Error(`List message excede el máximo de ${LIST_MESSAGE_LIMITS.MAX_ROWS} filas (tiene ${totalRows})`);
  }

  for (const section of sections) {
    for (const row of section.rows) {
      if (row.title.length > LIST_MESSAGE_LIMITS.TITLE_MAX) {
        throw new Error(`El title de la fila "${row.id}" excede ${LIST_MESSAGE_LIMITS.TITLE_MAX} caracteres`);
      }
      if (row.description && row.description.length > LIST_MESSAGE_LIMITS.DESCRIPTION_MAX) {
        throw new Error(`La description de la fila "${row.id}" excede ${LIST_MESSAGE_LIMITS.DESCRIPTION_MAX} caracteres`);
      }
    }
  }
};

const sendListMessage = async (to, { headerText, bodyText, footerText, buttonText, sections }) => {
  validarListMessageSections(sections);

  const url = `${GRAPH_BASE_URL}/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        header: { type: 'text', text: headerText },
        body: { text: bodyText },
        footer: { text: footerText },
        action: { button: buttonText, sections },
      },
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    logger.error('Error enviando list message de WhatsApp', res.status, errorBody);
    throw new Error(`WhatsApp API error: ${res.status}`);
  }

  return res.json();
};

const MENU_PRINCIPAL_SECTIONS = [
  {
    title: 'Documentos',
    rows: [
      { id: MENU_IDS.EMITIR_FACTURA, title: 'Emitir factura', description: 'Factura electrónica nueva' },
      { id: MENU_IDS.NOTA_CREDITO, title: 'Nota de crédito', description: 'Sobre una factura emitida' },
      { id: MENU_IDS.CANCELAR_DOCUMENTO, title: 'Cancelar documento', description: 'Factura o NC ya emitida' },
    ],
  },
];

// Menú inicial de ruteo entre operaciones. Reutilizable desde el orquestador cada vez
// que hay que ofrecerle al usuario las opciones (saludo, fuera de alcance, id
// desconocido, etc.).
const enviarMenuPrincipal = (to) => {
  return sendListMessage(to, {
    headerText: 'Factyble',
    bodyText: 'Hola 😁 ¿Qué querés hacer?',
    footerText: 'Elegí una opción',
    buttonText: 'Ver opciones',
    sections: MENU_PRINCIPAL_SECTIONS,
  });
};

// Sube un archivo (ej. el PDF de una factura descargado de la API de facturación) a
// los servidores de Meta y devuelve un media id reutilizable en sendDocumentMessage.
const uploadMedia = async (buffer, filename, mimeType) => {
  const url = `${GRAPH_BASE_URL}/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/media`;

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', new Blob([buffer], { type: mimeType }), filename);

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
    body: form,
  });

  if (!res.ok) {
    const errorBody = await res.text();
    logger.error('Error subiendo media a WhatsApp', res.status, errorBody);
    throw new Error(`WhatsApp API error: ${res.status}`);
  }

  return res.json();
};

// Resuelve el media id de un mensaje entrante (audio/imagen/documento) a la URL
// temporal firmada de Meta desde donde descargar el binario (GET /{media-id}).
const getMediaUrl = async (mediaId) => {
  const url = `${GRAPH_BASE_URL}/${env.WHATSAPP_API_VERSION}/${mediaId}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
  });

  if (!res.ok) {
    const errorBody = await res.text();
    logger.error('Error obteniendo URL de media de WhatsApp', res.status, errorBody);
    throw new Error(`WhatsApp API error: ${res.status}`);
  }

  return res.json();
};

// Descarga el binario de un media entrante (ej. una nota de voz) para su
// procesamiento local (ej. transcripción). La URL de getMediaUrl expira y solo es
// accesible con el mismo access token de la app, por eso el segundo GET también lleva
// el header Authorization.
const downloadMedia = async (mediaId) => {
  const { url, mime_type: mimeType } = await getMediaUrl(mediaId);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
  });

  if (!res.ok) {
    const errorBody = await res.text();
    logger.error('Error descargando media de WhatsApp', res.status, errorBody);
    throw new Error(`WhatsApp API error: ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), mimeType };
};

// Sobrescribe la callback URL del webhook a nivel de WABA (override_callback_uri),
// que es la forma soportada de registrar/actualizar por API a qué URL manda Meta los
// eventos, sin pasar por el Meta App Dashboard.
const updateWebhookUrl = async (webhookUrl) => {
  const url = `${GRAPH_BASE_URL}/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_BUSINESS_ACCOUNT_ID}/subscribed_apps`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      override_callback_uri: webhookUrl,
      verify_token: env.WHATSAPP_VERIFY_TOKEN,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Meta API respondió ${res.status}: ${JSON.stringify(data)}`);
  }

  return data;
};

// Verifica la firma HMAC-SHA256 (header X-Hub-Signature-256) que Meta agrega a cada
// entrega de webhook, calculada sobre el cuerpo crudo de la request (ver
// index.js -> express.json({ verify }) que expone req.rawBody).
const verifySignature = (rawBody, signatureHeader) => {
  if (!signatureHeader || !rawBody || !env.WHATSAPP_APP_SECRET) return false;

  const esperada = `sha256=${crypto.createHmac('sha256', env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex')}`;

  const bufferEsperado = Buffer.from(esperada);
  const bufferRecibido = Buffer.from(signatureHeader);

  if (bufferEsperado.length !== bufferRecibido.length) return false;

  return crypto.timingSafeEqual(bufferEsperado, bufferRecibido);
};

module.exports = {
  sendTextMessage,
  sendDocumentMessage,
  sendListMessage,
  enviarMenuPrincipal,
  uploadMedia,
  downloadMedia,
  updateWebhookUrl,
  verifySignature,
};
