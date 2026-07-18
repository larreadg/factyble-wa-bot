const test = require('node:test');
const assert = require('node:assert/strict');
const facturaEmisionService = require('../../src/services/facturaEmision.service');
const facturaApiService = require('../../src/services/facturaApi.service');
const empresaService = require('../../src/services/empresa.service');
const { FacturaApiError } = require('../../src/services/facturaApi.errors');
const crypto = require('../../src/utils/crypto');

const construirJwt = (payload) => {
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode(payload)}.firma-fake`;
};

// La contraseña siempre viaja cifrada (ver src/utils/crypto.js); acá se cifra una
// contraseña de prueba para que emitirFactura pueda descifrarla como en producción.
const PASSWORD_CIFRADA = crypto.encrypt('password-de-prueba');

const EMPRESA_SIN_TOKEN = () => ({ id: 1, usuario: 'admin@empresa.com', password: PASSWORD_CIFRADA, token: null, tokenExpiracion: null });

const DATOS_FACTURA = {
  cliente: { nombre: 'Diego Larrea', tipoDocumento: 'RUC', numeroDocumento: '5249657-0' },
  condicionVenta: 'CONTADO',
  items: [{ descripcion: 'Borrador', cantidad: 1, precioUnitario: 5000, tasa: '10%' }],
  totales: { subtotal: 5000, totalGeneral: 5000 },
  idempotencyKey: 'factyble:whatsapp:10:100:1',
};

const RESPUESTA_EMISION = {
  id: 123,
  numero_factura: 45,
  numeroFacturaFormateada: '001-001-0000045',
  cdc: '01800695921001001000000012024071410238123456',
  pdfNombre: 'b3c1-uuid.pdf',
  estado_sifen: 'FIRMADO',
  sifen_estado_mensaje: null,
};

test('sin token cacheado: autentica y emite, sin tocar WhatsApp (el PDF se envía recién cuando SIFEN aprueba)', async (t) => {
  const jwt = construirJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
  const autenticarSpy = t.mock.method(facturaApiService, 'autenticar', async () => jwt);
  const emitirSpy = t.mock.method(facturaApiService, 'emitirFacturaSimple', async () => RESPUESTA_EMISION);
  const descargarSpy = t.mock.method(facturaApiService, 'descargarPdf', async () => {
    throw new Error('no debería llamarse');
  });
  const guardarTokenSpy = t.mock.method(empresaService, 'guardarToken', async () => {});

  const resultado = await facturaEmisionService.emitirFactura({ empresa: EMPRESA_SIN_TOKEN(), ...DATOS_FACTURA });

  assert.equal(autenticarSpy.mock.callCount(), 1);
  assert.equal(guardarTokenSpy.mock.callCount(), 1);
  assert.equal(emitirSpy.mock.callCount(), 1);
  assert.equal(emitirSpy.mock.calls[0].arguments[0], jwt);

  const payloadEnviado = emitirSpy.mock.calls[0].arguments[1];
  assert.equal(payloadEnviado.situacionTributaria, 'CONTRIBUYENTE');
  assert.equal(payloadEnviado.personaDocumento, '5249657-0');
  assert.equal(payloadEnviado.personaNombre, 'Diego Larrea');
  assert.equal(payloadEnviado.condicionVenta, 'CONTADO');
  assert.deepEqual(payloadEnviado.items, [{ cantidad: 1, precioUnitario: 5000, tasa: '10%', descripcion: 'Borrador' }]);

  assert.equal(descargarSpy.mock.callCount(), 0);

  assert.equal(resultado.documentoId, 123);
  assert.equal(resultado.numero, 45);
  assert.equal(resultado.numeroFormateado, '001-001-0000045');
  assert.equal(resultado.cdc, '01800695921001001000000012024071410238123456');
  assert.equal(resultado.pdfNombre, 'b3c1-uuid.pdf');
  assert.equal(resultado.estadoSifen, 'FIRMADO');
  assert.equal(resultado.sifenEstadoMensaje, null);
});

test('cliente con cédula (CI): situacionTributaria=NO_CONTRIBUYENTE y personaDocumento=numeroDocumento', async (t) => {
  const empresa = { id: 7, usuario: 'admin@empresa.com', password: 'x', token: 'token-vigente', tokenExpiracion: new Date(Date.now() + 3600 * 1000) };
  const emitirSpy = t.mock.method(facturaApiService, 'emitirFacturaSimple', async () => RESPUESTA_EMISION);

  const datosConCedula = { ...DATOS_FACTURA, cliente: { nombre: 'Diego Larrea', tipoDocumento: 'CI', numeroDocumento: '5249657' } };
  await facturaEmisionService.emitirFactura({ empresa, ...datosConCedula });

  const payloadEnviado = emitirSpy.mock.calls[0].arguments[1];
  assert.equal(payloadEnviado.situacionTributaria, 'NO_CONTRIBUYENTE');
  assert.equal(payloadEnviado.personaDocumento, '5249657');
});

test('con token cacheado vigente, no vuelve a autenticar', async (t) => {
  const empresa = { id: 2, usuario: 'admin@empresa.com', password: 'x', token: 'token-cacheado', tokenExpiracion: new Date(Date.now() + 3600 * 1000) };
  const autenticarSpy = t.mock.method(facturaApiService, 'autenticar', async () => {
    throw new Error('no debería reautenticar');
  });
  const emitirSpy = t.mock.method(facturaApiService, 'emitirFacturaSimple', async () => RESPUESTA_EMISION);
  t.mock.method(empresaService, 'guardarToken', async () => {});

  await facturaEmisionService.emitirFactura({ empresa, ...DATOS_FACTURA });

  assert.equal(autenticarSpy.mock.callCount(), 0);
  assert.equal(emitirSpy.mock.calls[0].arguments[0], 'token-cacheado');
});

test('con token cacheado vencido, reautentica antes de emitir', async (t) => {
  const empresa = { id: 3, usuario: 'admin@empresa.com', password: PASSWORD_CIFRADA, token: 'token-viejo', tokenExpiracion: new Date(Date.now() - 1000) };
  const jwt = construirJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
  const autenticarSpy = t.mock.method(facturaApiService, 'autenticar', async () => jwt);
  const emitirSpy = t.mock.method(facturaApiService, 'emitirFacturaSimple', async () => RESPUESTA_EMISION);
  t.mock.method(empresaService, 'guardarToken', async () => {});

  await facturaEmisionService.emitirFactura({ empresa, ...DATOS_FACTURA });

  assert.equal(autenticarSpy.mock.callCount(), 1);
  assert.equal(emitirSpy.mock.calls[0].arguments[0], jwt);
});

test('token cacheado rechazado (401/AUTH_FAILED) reautentica una vez y reintenta la emisión', async (t) => {
  const empresa = { id: 4, usuario: 'admin@empresa.com', password: PASSWORD_CIFRADA, token: 'token-invalido', tokenExpiracion: new Date(Date.now() + 3600 * 1000) };
  const jwtNuevo = construirJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });

  const autenticarSpy = t.mock.method(facturaApiService, 'autenticar', async () => jwtNuevo);
  let intentos = 0;
  const emitirSpy = t.mock.method(facturaApiService, 'emitirFacturaSimple', async (token) => {
    intentos += 1;
    if (token === 'token-invalido') throw new FacturaApiError('AUTH_FAILED', 'Token inválido o expirado');
    return RESPUESTA_EMISION;
  });
  t.mock.method(empresaService, 'guardarToken', async () => {});

  const resultado = await facturaEmisionService.emitirFactura({ empresa, ...DATOS_FACTURA });

  assert.equal(autenticarSpy.mock.callCount(), 1);
  assert.equal(emitirSpy.mock.callCount(), 2);
  assert.equal(intentos, 2);
  assert.equal(resultado.documentoId, 123);
});

test('errores de validación (400) se propagan sin reintentar la autenticación', async (t) => {
  const empresa = { id: 5, usuario: 'admin@empresa.com', password: 'x', token: 'token-vigente', tokenExpiracion: new Date(Date.now() + 3600 * 1000) };
  const autenticarSpy = t.mock.method(facturaApiService, 'autenticar', async () => {
    throw new Error('no debería llamarse');
  });
  t.mock.method(facturaApiService, 'emitirFacturaSimple', async () => {
    throw new FacturaApiError('VALIDATION', 'RUC inválido');
  });

  await assert.rejects(
    () => facturaEmisionService.emitirFactura({ empresa, ...DATOS_FACTURA }),
    (err) => err instanceof FacturaApiError && err.type === 'VALIDATION',
  );
  assert.equal(autenticarSpy.mock.callCount(), 0);
});

test('sin pdfNombre en la respuesta, igual devuelve el resto de los datos', async (t) => {
  const empresa = { id: 6, usuario: 'admin@empresa.com', password: 'x', token: 'token-vigente', tokenExpiracion: new Date(Date.now() + 3600 * 1000) };
  t.mock.method(facturaApiService, 'emitirFacturaSimple', async () => ({ id: 1, numero_factura: 1, cdc: 'cdc-1', estado_sifen: 'FIRMADO' }));

  const resultado = await facturaEmisionService.emitirFactura({ empresa, ...DATOS_FACTURA });

  assert.equal(resultado.pdfNombre, null);
  assert.equal(resultado.cdc, 'cdc-1');
  assert.equal(resultado.estadoSifen, 'FIRMADO');
});
