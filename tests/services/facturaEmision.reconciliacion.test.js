const test = require('node:test');
const assert = require('node:assert/strict');
const facturaEmisionService = require('../../src/services/facturaEmision.service');
const facturaApiService = require('../../src/services/facturaApi.service');
const { FacturaApiError } = require('../../src/services/facturaApi.errors');

const EMPRESA = () => ({ id: 9, usuario: 'admin@empresa.com', password: 'x', token: 'token-vigente', tokenExpiracion: new Date(Date.now() + 3600 * 1000) });

const DATOS = {
  cliente: { nombre: 'Natalia Britez', tipoDocumento: 'RUC', numeroDocumento: '5851866-5' },
  condicionVenta: 'CONTADO',
  items: [{ descripcion: 'Furuka tradicional', cantidad: 1, precioUnitario: 24000, tasa: '10%' }],
  totales: { subtotal: 24000, totalGeneral: 24000 },
  idempotencyKey: 'factyble:whatsapp:5:5:1',
};

const RESPUESTA_OK = {
  id: 80,
  numero_factura: 7,
  numeroFacturaFormateada: '001-002-0000007',
  cdc: '01050921665001002000000712026081718954695790',
  pdfNombre: '707af555-7476-4004-b13b-b5c1942f75a5.pdf',
  clienteNombre: 'Natalia Britez',
  clienteDocumento: '5851866-5',
  estado_sifen: 'FIRMADO',
  sifen_estado_mensaje: null,
};

// Forma que devuelve GET /factura/id-externo (distinta al POST): numero_factura ya formateado,
// sin pdfNombre/cliente sintetizados; el cliente vive en cliente_empresa.cliente.
const FACTURA_RECONCILIADA = {
  id: 80,
  numero_factura: '001-002-0000007',
  factura_uuid: '707af555-7476-4004-b13b-b5c1942f75a5',
  cdc: '01050921665001002000000712026081718954695790',
  estado_sifen: 'FIRMADO',
  sifen_estado_mensaje: null,
  cliente_empresa: { cliente: { razon_social: 'Natalia Britez', ruc: '5851866-5' } },
};

const err503 = () => new FacturaApiError('SERVER_ERROR', 'Service Unavailable', undefined, 503);

test('emite OK en un solo intento (sin reintento en el request) y manda idExterno', async (t) => {
  const emitirSpy = t.mock.method(facturaApiService, 'emitirFacturaSimple', async () => RESPUESTA_OK);
  const buscarSpy = t.mock.method(facturaApiService, 'buscarFacturaPorIdExterno', async () => null);

  const resultado = await facturaEmisionService.emitirFactura({ empresa: EMPRESA(), ...DATOS });

  assert.equal(emitirSpy.mock.callCount(), 1);
  assert.equal(buscarSpy.mock.callCount(), 0);
  assert.equal(emitirSpy.mock.calls[0].arguments[1].idExterno, 'factyble:whatsapp:5:5:1');
  assert.equal(resultado.cdc, RESPUESTA_OK.cdc);
});

test('error transitorio + reconciliación ENCONTRADA: devuelve la factura ya existente sin reemitir', async (t) => {
  const emitirSpy = t.mock.method(facturaApiService, 'emitirFacturaSimple', async () => {
    throw new FacturaApiError('TIMEOUT', 'Timeout llamando a la API de facturación');
  });
  const buscarSpy = t.mock.method(facturaApiService, 'buscarFacturaPorIdExterno', async () => FACTURA_RECONCILIADA);

  const resultado = await facturaEmisionService.emitirFactura({ empresa: EMPRESA(), ...DATOS });

  assert.equal(emitirSpy.mock.callCount(), 1);
  assert.equal(buscarSpy.mock.callCount(), 1);
  assert.equal(resultado.documentoId, 80);
  assert.equal(resultado.numeroFormateado, '001-002-0000007');
  assert.equal(resultado.pdfNombre, '707af555-7476-4004-b13b-b5c1942f75a5.pdf');
  assert.equal(resultado.clienteNombre, 'Natalia Britez');
  assert.equal(resultado.clienteDocumento, '5851866-5');
});

test('error transitorio + reconciliación NO_EXISTE (404): propaga el error (no reintenta en el request)', async (t) => {
  const emitirSpy = t.mock.method(facturaApiService, 'emitirFacturaSimple', async () => {
    throw err503();
  });
  const buscarSpy = t.mock.method(facturaApiService, 'buscarFacturaPorIdExterno', async () => null);

  await assert.rejects(
    () => facturaEmisionService.emitirFactura({ empresa: EMPRESA(), ...DATOS }),
    (err) => err instanceof FacturaApiError && err.type === 'SERVER_ERROR',
  );

  assert.equal(emitirSpy.mock.callCount(), 1);
  assert.equal(buscarSpy.mock.callCount(), 1);
});

test('error transitorio + reconciliación INDETERMINADA (la consulta falla): propaga el error', async (t) => {
  t.mock.method(facturaApiService, 'emitirFacturaSimple', async () => {
    throw err503();
  });
  const buscarSpy = t.mock.method(facturaApiService, 'buscarFacturaPorIdExterno', async () => {
    throw new FacturaApiError('SERVER_ERROR', 'gateway', undefined, 502);
  });

  await assert.rejects(
    () => facturaEmisionService.emitirFactura({ empresa: EMPRESA(), ...DATOS }),
    (err) => err instanceof FacturaApiError,
  );

  assert.equal(buscarSpy.mock.callCount(), 1);
});

test('reconciliarPrimero=true + ya existe: devuelve la factura sin postear (no duplica en el reintento)', async (t) => {
  const emitirSpy = t.mock.method(facturaApiService, 'emitirFacturaSimple', async () => {
    throw new Error('no debería postear en un reintento si ya existe');
  });
  const buscarSpy = t.mock.method(facturaApiService, 'buscarFacturaPorIdExterno', async () => FACTURA_RECONCILIADA);

  const resultado = await facturaEmisionService.emitirFactura({ empresa: EMPRESA(), ...DATOS, reconciliarPrimero: true });

  assert.equal(buscarSpy.mock.callCount(), 1);
  assert.equal(emitirSpy.mock.callCount(), 0, 'no debe postear: reconcilió primero y la factura ya existía');
  assert.equal(resultado.cdc, RESPUESTA_OK.cdc);
});

test('reconciliarPrimero=true + NO existe (404): recién ahí postea', async (t) => {
  const emitirSpy = t.mock.method(facturaApiService, 'emitirFacturaSimple', async () => RESPUESTA_OK);
  const buscarSpy = t.mock.method(facturaApiService, 'buscarFacturaPorIdExterno', async () => null);

  const resultado = await facturaEmisionService.emitirFactura({ empresa: EMPRESA(), ...DATOS, reconciliarPrimero: true });

  assert.equal(buscarSpy.mock.callCount(), 1);
  assert.equal(emitirSpy.mock.callCount(), 1);
  assert.equal(resultado.cdc, RESPUESTA_OK.cdc);
});

test('reconciliarPrimero=true + consulta indeterminada: NO postea (pospone el reintento)', async (t) => {
  const emitirSpy = t.mock.method(facturaApiService, 'emitirFacturaSimple', async () => RESPUESTA_OK);
  t.mock.method(facturaApiService, 'buscarFacturaPorIdExterno', async () => {
    throw new FacturaApiError('SERVER_ERROR', 'gateway', undefined, 502);
  });

  await assert.rejects(() => facturaEmisionService.emitirFactura({ empresa: EMPRESA(), ...DATOS, reconciliarPrimero: true }));
  assert.equal(emitirSpy.mock.callCount(), 0, 'no debe postear si no pudo confirmar que la factura no existe');
});

test('reconciliación de una factura RECHAZADA por SIFEN: no se entrega (se trata como indeterminado)', async (t) => {
  t.mock.method(facturaApiService, 'emitirFacturaSimple', async () => {
    throw err503();
  });
  const buscarSpy = t.mock.method(facturaApiService, 'buscarFacturaPorIdExterno', async () => ({ ...FACTURA_RECONCILIADA, estado_sifen: 'RECHAZADO' }));

  // 503 en el POST, la reconciliación encuentra una factura RECHAZADA -> no entregable ->
  // se propaga el error en vez de devolverla como éxito.
  await assert.rejects(
    () => facturaEmisionService.emitirFactura({ empresa: EMPRESA(), ...DATOS }),
    (err) => err instanceof FacturaApiError,
  );
  assert.equal(buscarSpy.mock.callCount(), 1);
});

test('rechazo de datos (400 VALIDATION): propaga sin reconciliar (no es una caída del servicio)', async (t) => {
  const emitirSpy = t.mock.method(facturaApiService, 'emitirFacturaSimple', async () => {
    throw new FacturaApiError('VALIDATION', 'RUC inválido');
  });
  const buscarSpy = t.mock.method(facturaApiService, 'buscarFacturaPorIdExterno', async () => null);

  await assert.rejects(
    () => facturaEmisionService.emitirFactura({ empresa: EMPRESA(), ...DATOS }),
    (err) => err instanceof FacturaApiError && err.type === 'VALIDATION',
  );

  assert.equal(emitirSpy.mock.callCount(), 1);
  assert.equal(buscarSpy.mock.callCount(), 0);
});
