const test = require('node:test');
const assert = require('node:assert/strict');
const notaCreditoEmisionService = require('../../src/services/notaCreditoEmision.service');
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

const ITEMS = [{ descripcion: 'Silla', cantidad: 2, precioUnitario: 50000, tasa: '10%' }];

test('consultarTotalFactura: sin token cacheado, autentica y consulta', async (t) => {
  const jwt = construirJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
  const autenticarSpy = t.mock.method(facturaApiService, 'autenticar', async () => jwt);
  const consultarSpy = t.mock.method(facturaApiService, 'consultarTotalFactura', async () => ({ cdc: CDC, total: 550000, totalIva: 50000 }));
  t.mock.method(empresaService, 'guardarToken', async () => {});

  const resultado = await notaCreditoEmisionService.consultarTotalFactura(EMPRESA_SIN_TOKEN(), CDC);

  assert.equal(autenticarSpy.mock.callCount(), 1);
  assert.equal(consultarSpy.mock.calls[0].arguments[0], jwt);
  assert.equal(consultarSpy.mock.calls[0].arguments[1], CDC);
  assert.equal(resultado.total, 550000);
  assert.equal(resultado.totalIva, 50000);
});

test('consultarTotalFactura: con token cacheado vigente, no reautentica', async (t) => {
  const empresa = { id: 2, usuario: 'admin@empresa.com', password: 'x', token: 'token-cacheado', tokenExpiracion: new Date(Date.now() + 3600 * 1000) };
  const autenticarSpy = t.mock.method(facturaApiService, 'autenticar', async () => {
    throw new Error('no debería reautenticar');
  });
  t.mock.method(facturaApiService, 'consultarTotalFactura', async () => ({ cdc: CDC, total: 100000, totalIva: 10000 }));

  await notaCreditoEmisionService.consultarTotalFactura(empresa, CDC);

  assert.equal(autenticarSpy.mock.callCount(), 0);
});

test('consultarTotalFactura: NOT_FOUND se propaga sin reautenticar', async (t) => {
  const empresa = { id: 3, usuario: 'admin@empresa.com', password: 'x', token: 'token-vigente', tokenExpiracion: new Date(Date.now() + 3600 * 1000) };
  const autenticarSpy = t.mock.method(facturaApiService, 'autenticar', async () => {
    throw new Error('no debería llamarse');
  });
  t.mock.method(facturaApiService, 'consultarTotalFactura', async () => {
    throw new FacturaApiError('NOT_FOUND', 'No se encontró factura con ese cdc');
  });

  await assert.rejects(
    () => notaCreditoEmisionService.consultarTotalFactura(empresa, CDC),
    (err) => err instanceof FacturaApiError && err.type === 'NOT_FOUND',
  );
  assert.equal(autenticarSpy.mock.callCount(), 0);
});

test('emitirNotaCredito: envía exactamente {cdc, items}, sin idempotencyKey ni otros campos', async (t) => {
  const empresa = { id: 4, usuario: 'admin@empresa.com', password: 'x', token: 'token-vigente', tokenExpiracion: new Date(Date.now() + 3600 * 1000) };
  const emitirSpy = t.mock.method(facturaApiService, 'emitirNotaCreditoSimple', async () => ({
    id: 10,
    numero_nota_credito: '001-001-0000045',
    numeroNotaCreditoFormateada: '001-001-0000045',
    cdc: CDC,
    pdfNombre: 'nc-uuid.pdf',
    estado_sifen: 'FIRMADO',
    sifen_estado_mensaje: null,
    linkqr: 'https://ejemplo.com/qr',
  }));

  const resultado = await notaCreditoEmisionService.emitirNotaCredito({ empresa, cdc: CDC, items: ITEMS });

  const payloadEnviado = emitirSpy.mock.calls[0].arguments[1];
  assert.deepEqual(Object.keys(payloadEnviado).sort(), ['cdc', 'items']);
  assert.equal(payloadEnviado.cdc, CDC);
  assert.deepEqual(payloadEnviado.items, [{ cantidad: 2, precioUnitario: 50000, descripcion: 'Silla', tasa: '10%' }]);

  assert.equal(resultado.numero, '001-001-0000045');
  assert.equal(resultado.numeroFormateado, '001-001-0000045');
  assert.equal(resultado.cdc, CDC);
  assert.equal(resultado.pdfNombre, 'nc-uuid.pdf');
  assert.equal(resultado.estadoSifen, 'FIRMADO');
  assert.equal(resultado.linkQr, 'https://ejemplo.com/qr');
});

test('emitirNotaCredito: token rechazado (401/AUTH_FAILED) reautentica una vez y reintenta', async (t) => {
  const empresa = { id: 5, usuario: 'admin@empresa.com', password: PASSWORD_CIFRADA, token: 'token-invalido', tokenExpiracion: new Date(Date.now() + 3600 * 1000) };
  const jwtNuevo = construirJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });

  const autenticarSpy = t.mock.method(facturaApiService, 'autenticar', async () => jwtNuevo);
  let intentos = 0;
  const emitirSpy = t.mock.method(facturaApiService, 'emitirNotaCreditoSimple', async (token) => {
    intentos += 1;
    if (token === 'token-invalido') throw new FacturaApiError('AUTH_FAILED', 'Token inválido o expirado');
    return { id: 1, numero_nota_credito: '001-001-0000001', cdc: CDC, estado_sifen: 'APROBADO', linkqr: null };
  });
  t.mock.method(empresaService, 'guardarToken', async () => {});

  const resultado = await notaCreditoEmisionService.emitirNotaCredito({ empresa, cdc: CDC, items: ITEMS });

  assert.equal(autenticarSpy.mock.callCount(), 1);
  assert.equal(emitirSpy.mock.callCount(), 2);
  assert.equal(intentos, 2);
  assert.equal(resultado.documentoId, 1);
});

test('emitirNotaCredito: error de validación (400) se propaga sin reintentar autenticación', async (t) => {
  const empresa = { id: 6, usuario: 'admin@empresa.com', password: 'x', token: 'token-vigente', tokenExpiracion: new Date(Date.now() + 3600 * 1000) };
  const autenticarSpy = t.mock.method(facturaApiService, 'autenticar', async () => {
    throw new Error('no debería llamarse');
  });
  t.mock.method(facturaApiService, 'emitirNotaCreditoSimple', async () => {
    throw new FacturaApiError('VALIDATION', 'La factura se encuentra cancelada');
  });

  await assert.rejects(
    () => notaCreditoEmisionService.emitirNotaCredito({ empresa, cdc: CDC, items: ITEMS }),
    (err) => err instanceof FacturaApiError && err.type === 'VALIDATION' && err.message === 'La factura se encuentra cancelada',
  );
  assert.equal(autenticarSpy.mock.callCount(), 0);
});
