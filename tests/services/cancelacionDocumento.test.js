const test = require('node:test');
const assert = require('node:assert/strict');
const cancelacionDocumentoService = require('../../src/services/cancelacionDocumento.service');
const facturaApiService = require('../../src/services/facturaApi.service');
const empresaService = require('../../src/services/empresa.service');
const { FacturaApiError } = require('../../src/services/facturaApi.errors');
const crypto = require('../../src/utils/crypto');

const construirJwt = (payload) => {
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode(payload)}.firma-fake`;
};

const PASSWORD_CIFRADA = crypto.encrypt('password-de-prueba');
const CDC = '01800695921001001000000012024071410238123456';

const EMPRESA_SIN_TOKEN = () => ({ id: 1, usuario: 'admin@empresa.com', password: PASSWORD_CIFRADA, token: null, tokenExpiracion: null });
const EMPRESA_CON_TOKEN = (overrides = {}) => ({
  id: 2,
  usuario: 'admin@empresa.com',
  password: PASSWORD_CIFRADA,
  token: 'token-vigente',
  tokenExpiracion: new Date(Date.now() + 3600 * 1000),
  ...overrides,
});

test('cancelarFactura: sin token cacheado, autentica y cancela', async (t) => {
  const jwt = construirJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
  const autenticarSpy = t.mock.method(facturaApiService, 'autenticar', async () => jwt);
  const cancelarSpy = t.mock.method(facturaApiService, 'cancelarFacturaSimple', async () => ({
    estado_sifen: 'CANCELADO',
    mensaje_respuesta: 'Transacción aprobada',
    codigo_respuesta: '0260',
  }));
  t.mock.method(empresaService, 'guardarToken', async () => {});

  const resultado = await cancelacionDocumentoService.cancelarFactura(EMPRESA_SIN_TOKEN(), CDC);

  assert.equal(autenticarSpy.mock.callCount(), 1);
  assert.equal(cancelarSpy.mock.calls[0].arguments[0], jwt);
  assert.deepEqual(cancelarSpy.mock.calls[0].arguments[1], { cdc: CDC });
  assert.equal(resultado.estadoSifen, 'CANCELADO');
  assert.equal(resultado.mensajeRespuesta, 'Transacción aprobada');
  assert.equal(resultado.codigoRespuesta, '0260');
});

test('cancelarFactura: con token cacheado vigente, no reautentica', async (t) => {
  const autenticarSpy = t.mock.method(facturaApiService, 'autenticar', async () => {
    throw new Error('no debería reautenticar');
  });
  t.mock.method(facturaApiService, 'cancelarFacturaSimple', async () => ({ estado_sifen: 'CANCELADO' }));

  await cancelacionDocumentoService.cancelarFactura(EMPRESA_CON_TOKEN(), CDC);

  assert.equal(autenticarSpy.mock.callCount(), 0);
});

test('cancelarFactura: token rechazado (401/AUTH_FAILED) reautentica una vez y reintenta', async (t) => {
  const empresa = EMPRESA_CON_TOKEN({ token: 'token-invalido', password: PASSWORD_CIFRADA });
  const jwtNuevo = construirJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });

  const autenticarSpy = t.mock.method(facturaApiService, 'autenticar', async () => jwtNuevo);
  let intentos = 0;
  const cancelarSpy = t.mock.method(facturaApiService, 'cancelarFacturaSimple', async (token) => {
    intentos += 1;
    if (token === 'token-invalido') throw new FacturaApiError('AUTH_FAILED', 'Token inválido o expirado');
    return { estado_sifen: 'CANCELADO' };
  });
  t.mock.method(empresaService, 'guardarToken', async () => {});

  const resultado = await cancelacionDocumentoService.cancelarFactura(empresa, CDC);

  assert.equal(autenticarSpy.mock.callCount(), 1);
  assert.equal(cancelarSpy.mock.callCount(), 2);
  assert.equal(intentos, 2);
  assert.equal(resultado.estadoSifen, 'CANCELADO');
});

test('cancelarFactura: SIFEN rechaza el evento (200 con estado distinto de CANCELADO) se propaga tal cual', async (t) => {
  t.mock.method(facturaApiService, 'cancelarFacturaSimple', async () => ({
    estado_sifen: 'APROBADO',
    mensaje_respuesta: 'El plazo para cancelar el documento ya venció',
    codigo_respuesta: '0420',
  }));

  const resultado = await cancelacionDocumentoService.cancelarFactura(EMPRESA_CON_TOKEN(), CDC);

  assert.equal(resultado.estadoSifen, 'APROBADO');
  assert.equal(resultado.mensajeRespuesta, 'El plazo para cancelar el documento ya venció');
  assert.equal(resultado.codigoRespuesta, '0420');
});

test('cancelarFactura: NOT_FOUND (404) se propaga sin reautenticar', async (t) => {
  const autenticarSpy = t.mock.method(facturaApiService, 'autenticar', async () => {
    throw new Error('no debería llamarse');
  });
  t.mock.method(facturaApiService, 'cancelarFacturaSimple', async () => {
    throw new FacturaApiError('NOT_FOUND', 'No se encontró factura con ese cdc');
  });

  await assert.rejects(
    () => cancelacionDocumentoService.cancelarFactura(EMPRESA_CON_TOKEN(), CDC),
    (err) => err instanceof FacturaApiError && err.type === 'NOT_FOUND',
  );
  assert.equal(autenticarSpy.mock.callCount(), 0);
});

test('cancelarFactura: error de validación (400) se propaga sin reintentar autenticación', async (t) => {
  const autenticarSpy = t.mock.method(facturaApiService, 'autenticar', async () => {
    throw new Error('no debería llamarse');
  });
  t.mock.method(facturaApiService, 'cancelarFacturaSimple', async () => {
    throw new FacturaApiError('VALIDATION', 'La Factura ya se encuentra con estado Cancelado');
  });

  await assert.rejects(
    () => cancelacionDocumentoService.cancelarFactura(EMPRESA_CON_TOKEN(), CDC),
    (err) => err instanceof FacturaApiError && err.type === 'VALIDATION',
  );
  assert.equal(autenticarSpy.mock.callCount(), 0);
});

test('cancelarNotaCredito: envía exactamente {cdc} y mapea la respuesta', async (t) => {
  const cancelarSpy = t.mock.method(facturaApiService, 'cancelarNotaCreditoSimple', async () => ({
    estado_sifen: 'CANCELADO',
    mensaje_respuesta: 'Transacción aprobada',
    codigo_respuesta: '0260',
  }));

  const resultado = await cancelacionDocumentoService.cancelarNotaCredito(EMPRESA_CON_TOKEN(), CDC);

  assert.deepEqual(cancelarSpy.mock.calls[0].arguments[1], { cdc: CDC });
  assert.equal(resultado.estadoSifen, 'CANCELADO');
});

test('cancelarNotaCredito: token rechazado reautentica una vez y reintenta', async (t) => {
  const empresa = EMPRESA_CON_TOKEN({ token: 'token-invalido', password: PASSWORD_CIFRADA });
  const jwtNuevo = construirJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });

  const autenticarSpy = t.mock.method(facturaApiService, 'autenticar', async () => jwtNuevo);
  const cancelarSpy = t.mock.method(facturaApiService, 'cancelarNotaCreditoSimple', async (token) => {
    if (token === 'token-invalido') throw new FacturaApiError('AUTH_FAILED', 'Token inválido o expirado');
    return { estado_sifen: 'CANCELADO' };
  });
  t.mock.method(empresaService, 'guardarToken', async () => {});

  const resultado = await cancelacionDocumentoService.cancelarNotaCredito(empresa, CDC);

  assert.equal(autenticarSpy.mock.callCount(), 1);
  assert.equal(cancelarSpy.mock.callCount(), 2);
  assert.equal(resultado.estadoSifen, 'CANCELADO');
});
