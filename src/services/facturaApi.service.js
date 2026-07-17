const env = require('../utils/env');
const logger = require('../utils/logger');
const { FacturaApiError } = require('./facturaApi.errors');

const construirUrl = (path) => `${env.FACTURACION_API_BASE_URL}${path}`;

const parseJsonSeguro = async (res) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

const fetchConTimeout = async (url, options) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), env.FACTURACION_API_TIMEOUT_MS);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new FacturaApiError('TIMEOUT', 'Timeout llamando a la API de facturación', err);
    }
    throw new FacturaApiError('NETWORK', 'Error de red llamando a la API de facturación', err);
  } finally {
    clearTimeout(timeoutId);
  }
};

// POST /usuario/authenticate. El usuario debe tener rol ADMIN en la empresa emisora
// (de ahí se resuelve establecimiento/caja); x-client-type: api salta el captcha
// pensado para logins humanos.
const autenticar = async ({ usuario, password }) => {
  const res = await fetchConTimeout(construirUrl('/usuario/authenticate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-client-type': 'api' },
    body: JSON.stringify({ usuario, password }),
  });

  const body = await parseJsonSeguro(res);

  if (!res.ok) {
    logger.error('Error autenticando contra la API de facturación', res.status, body?.message);
    throw new FacturaApiError('AUTH_FAILED', body?.message || 'No se pudo autenticar con la API de facturación');
  }

  const token = body?.data?.token;
  if (!token) {
    throw new FacturaApiError('AUTH_FAILED', 'La API de facturación no devolvió un token');
  }

  return token;
};

// POST /factura/simple. impuesto/total por ítem y total/totalIva generales los
// calcula el backend de facturación: nunca se envían desde acá.
const emitirFacturaSimple = async (token, payload) => {
  const res = await fetchConTimeout(construirUrl('/factura/simple'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const body = await parseJsonSeguro(res);

  if (!res.ok) {
    logger.error('Error emitiendo factura en la API de facturación', res.status, body?.message);

    if (res.status === 401) throw new FacturaApiError('AUTH_FAILED', body?.message || 'Token inválido o expirado');
    if (res.status === 400) throw new FacturaApiError('VALIDATION', body?.message || 'Datos inválidos para emitir la factura');
    if (res.status === 404) throw new FacturaApiError('NOT_FOUND', body?.message || 'No se encontró establecimiento/caja/usuario');
    throw new FacturaApiError('SERVER_ERROR', body?.message || 'Error interno de la API de facturación');
  }

  return body.data;
};

// GET /public/<pdfNombre>: el PDF ya está generado y escrito en disco cuando
// /factura/simple responde, así que esta descarga no debería demorar.
const descargarPdf = async (pdfNombre) => {
  const res = await fetchConTimeout(construirUrl(`/public/${pdfNombre}`), { method: 'GET' });

  if (!res.ok) {
    throw new FacturaApiError('DOWNLOAD_FAILED', `No se pudo descargar el PDF de la factura (status ${res.status})`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

// GET /factura/cdc/:cdc/total: total bruto de la factura original (no descuenta NCs
// previas), usado para el control de monto antes de emitir una nota de crédito.
const consultarTotalFactura = async (token, cdc) => {
  const res = await fetchConTimeout(construirUrl(`/factura/cdc/${cdc}/total`), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  const body = await parseJsonSeguro(res);

  if (!res.ok) {
    logger.error('Error consultando total de factura por CDC', res.status, body?.message);

    if (res.status === 401) throw new FacturaApiError('AUTH_FAILED', body?.message || 'Token inválido o expirado');
    if (res.status === 400) throw new FacturaApiError('VALIDATION', body?.message || 'CDC con formato inválido');
    if (res.status === 404) throw new FacturaApiError('NOT_FOUND', body?.message || 'No se encontró factura con ese cdc');
    throw new FacturaApiError('SERVER_ERROR', body?.message || 'Error interno de la API de facturación');
  }

  return body.data;
};

// POST /nota-credito/simple. Body exacto {cdc, items}: el establecimiento/caja/cliente
// se resuelven del lado del servidor a partir del cdc, nunca se envían desde acá.
const emitirNotaCreditoSimple = async (token, payload) => {
  const res = await fetchConTimeout(construirUrl('/nota-credito/simple'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const body = await parseJsonSeguro(res);

  if (!res.ok) {
    logger.error('Error emitiendo nota de crédito', res.status, body?.message);

    if (res.status === 401) throw new FacturaApiError('AUTH_FAILED', body?.message || 'Token inválido o expirado');
    if (res.status === 400) throw new FacturaApiError('VALIDATION', body?.message || 'Datos inválidos para emitir la nota de crédito');
    if (res.status === 404) throw new FacturaApiError('NOT_FOUND', body?.message || 'No se encontró el cdc o falta configuración');
    throw new FacturaApiError('SERVER_ERROR', body?.message || 'Error interno de la API de facturación');
  }

  return body.data;
};

// POST /factura/simple/cancelar. Body exacto {cdc}: el motivo enviado a SIFEN ("A
// pedido del usuario") lo fija el backend de facturación, nunca se envía desde acá.
const cancelarFacturaSimple = async (token, payload) => {
  const res = await fetchConTimeout(construirUrl('/factura/simple/cancelar'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const body = await parseJsonSeguro(res);

  if (!res.ok) {
    logger.error('Error cancelando factura', res.status, body?.message);

    if (res.status === 401) throw new FacturaApiError('AUTH_FAILED', body?.message || 'Token inválido o expirado');
    if (res.status === 400) throw new FacturaApiError('VALIDATION', body?.message || 'Datos inválidos para cancelar la factura');
    if (res.status === 404) throw new FacturaApiError('NOT_FOUND', body?.message || 'No se encontró factura con ese cdc');
    throw new FacturaApiError('SERVER_ERROR', body?.message || 'Error interno de la API de facturación');
  }

  return body.data;
};

// POST /nota-credito/simple/cancelar. Mismo contrato que cancelarFacturaSimple.
const cancelarNotaCreditoSimple = async (token, payload) => {
  const res = await fetchConTimeout(construirUrl('/nota-credito/simple/cancelar'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const body = await parseJsonSeguro(res);

  if (!res.ok) {
    logger.error('Error cancelando nota de crédito', res.status, body?.message);

    if (res.status === 401) throw new FacturaApiError('AUTH_FAILED', body?.message || 'Token inválido o expirado');
    if (res.status === 400) throw new FacturaApiError('VALIDATION', body?.message || 'Datos inválidos para cancelar la nota de crédito');
    if (res.status === 404) throw new FacturaApiError('NOT_FOUND', body?.message || 'No se encontró nota de crédito con ese cdc');
    throw new FacturaApiError('SERVER_ERROR', body?.message || 'Error interno de la API de facturación');
  }

  return body.data;
};

module.exports = {
  autenticar,
  emitirFacturaSimple,
  descargarPdf,
  consultarTotalFactura,
  emitirNotaCreditoSimple,
  cancelarFacturaSimple,
  cancelarNotaCreditoSimple,
};
