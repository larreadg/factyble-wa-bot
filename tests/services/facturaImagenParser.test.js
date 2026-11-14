const test = require('node:test');
const assert = require('node:assert/strict');
const openaiService = require('../../src/services/openai.service');
const facturaImagenParserService = require('../../src/services/facturaImagenParser.service');
const { OpenAIServiceError } = require('../../src/services/openai.errors');

const { normalizarExtraccion, interpretarImagen, esMimeImagenSoportado } = facturaImagenParserService;

const EMISOR = { ruc: '80000000-1', razonSocial: 'Ferretería El Tornillo S.A.' };

const salidaBase = (overrides = {}) => ({
  esComprobanteDeVenta: true,
  cliente: { nombre: 'Juan Pérez', tipoDocumento: 'RUC', numeroDocumento: '5249657-0' },
  condicionVenta: 'CONTADO',
  plazoCredito: null,
  items: [
    { descripcion: 'Cemento', cantidad: 2, precioUnitario: 50000, importeLinea: 100000, tasa: '10%' },
    { descripcion: 'Arena', cantidad: 1, precioUnitario: 30000, importeLinea: 30000, tasa: '5%' },
  ],
  totalImpreso: 130000,
  advertencias: [],
  ...overrides,
});

// ---- normalizarExtraccion ----

test('extracción coherente: pasa a la forma factura sin advertencias', () => {
  const { factura, advertencias, vacia } = normalizarExtraccion(salidaBase(), { emisor: EMISOR });

  assert.equal(vacia, false);
  assert.deepEqual(advertencias, []);
  assert.deepEqual(factura.cliente, { nombre: 'Juan Pérez', tipoDocumento: 'RUC', numeroDocumento: '5249657-0' });
  assert.deepEqual(factura.items, [
    { descripcion: 'Cemento', cantidad: 2, precioUnitario: 50000, tasa: '10%' },
    { descripcion: 'Arena', cantidad: 1, precioUnitario: 30000, tasa: '5%' },
  ]);
});

test('línea con solo importe: se toma como 1 unidad por el importe', () => {
  const salida = salidaBase({
    items: [{ descripcion: 'Mano de obra', cantidad: null, precioUnitario: null, importeLinea: 250000, tasa: '10%' }],
    totalImpreso: 250000,
  });

  const { factura, advertencias } = normalizarExtraccion(salida, { emisor: EMISOR });

  assert.deepEqual(factura.items, [{ descripcion: 'Mano de obra', cantidad: 1, precioUnitario: 250000, tasa: '10%' }]);
  assert.deepEqual(advertencias, []);
});

test('precio unitario faltante se deduce de importe / cantidad solo si da exacto', () => {
  const salida = salidaBase({
    items: [
      { descripcion: 'Tornillo', cantidad: 4, precioUnitario: null, importeLinea: 2000, tasa: '10%' },
      { descripcion: 'Clavo', cantidad: 3, precioUnitario: null, importeLinea: 1000, tasa: '10%' },
    ],
    totalImpreso: null,
  });

  const { factura } = normalizarExtraccion(salida, { emisor: EMISOR });

  assert.equal(factura.items[0].precioUnitario, 500);
  assert.equal(factura.items[1].precioUnitario, null, '1000 / 3 no es un precio en guaraníes exacto: no se adivina');
});

test('cantidad faltante se deduce de importe / precio (admite decimales)', () => {
  const salida = salidaBase({
    items: [{ descripcion: 'Carne', cantidad: null, precioUnitario: 40000, importeLinea: 60000, tasa: '10%' }],
    totalImpreso: 60000,
  });

  const { factura } = normalizarExtraccion(salida, { emisor: EMISOR });

  assert.equal(factura.items[0].cantidad, 1.5);
});

test('cantidad × precio distinto del importe de la línea genera advertencia', () => {
  const salida = salidaBase({
    items: [{ descripcion: 'Cemento', cantidad: 2, precioUnitario: 80000, importeLinea: 100000, tasa: '10%' }],
    totalImpreso: null,
  });

  const { advertencias } = normalizarExtraccion(salida, { emisor: EMISOR });

  assert.equal(advertencias.length, 1);
  assert.match(advertencias[0], /Cemento/);
  assert.match(advertencias[0], /100\.000/);
});

test('suma de ítems distinta del total impreso genera advertencia', () => {
  const { advertencias } = normalizarExtraccion(salidaBase({ totalImpreso: 180000 }), { emisor: EMISOR });

  assert.equal(advertencias.length, 1);
  assert.match(advertencias[0], /no coincide con el total/);
});

test('sin total impreso o con ítems incompletos no se controla el total', () => {
  const incompletos = salidaBase({
    items: [{ descripcion: 'Cemento', cantidad: 2, precioUnitario: null, importeLinea: null, tasa: '10%' }],
    totalImpreso: 999999,
  });

  assert.deepEqual(normalizarExtraccion(incompletos, { emisor: EMISOR }).advertencias, []);
  assert.deepEqual(normalizarExtraccion(salidaBase({ totalImpreso: null }), { emisor: EMISOR }).advertencias, []);
});

test('el RUC del emisor nunca queda como cliente (con o sin guion)', () => {
  for (const numeroDocumento of ['80000000-1', '80000000']) {
    const salida = salidaBase({ cliente: { nombre: 'Juan Pérez', tipoDocumento: 'RUC', numeroDocumento } });
    const { factura, advertencias } = normalizarExtraccion(salida, { emisor: EMISOR });

    assert.equal(factura.cliente.numeroDocumento, null);
    assert.equal(factura.cliente.tipoDocumento, null);
    assert.equal(factura.cliente.nombre, 'Juan Pérez');
    assert.match(advertencias[0], /tu empresa/);
  }
});

test('la razón social del emisor no se usa como nombre del cliente', () => {
  const salida = salidaBase({ cliente: { nombre: 'FERRETERÍA EL TORNILLO  S.A.', tipoDocumento: null, numeroDocumento: null } });

  const { factura, advertencias } = normalizarExtraccion(salida, { emisor: EMISOR });

  assert.equal(factura.cliente.nombre, null);
  assert.deepEqual(advertencias, ['El nombre que figura en la foto es el de tu empresa, no el del cliente']);
});

test('sin cliente ni ítems la extracción se marca como vacía', () => {
  const salida = salidaBase({ cliente: { nombre: null, tipoDocumento: null, numeroDocumento: null }, items: [], totalImpreso: null });

  assert.equal(normalizarExtraccion(salida, { emisor: EMISOR }).vacia, true);
});

test('las advertencias del modelo se conservan', () => {
  const salida = salidaBase({ advertencias: ['No se lee bien la cantidad de "Arena"'] });

  assert.deepEqual(normalizarExtraccion(salida, { emisor: EMISOR }).advertencias, ['No se lee bien la cantidad de "Arena"']);
});

// ---- esMimeImagenSoportado ----

test('mime types soportados', () => {
  assert.equal(esMimeImagenSoportado('image/jpeg'), true);
  assert.equal(esMimeImagenSoportado('IMAGE/PNG'), true);
  assert.equal(esMimeImagenSoportado('image/webp; charset=binary'), true);
  assert.equal(esMimeImagenSoportado('image/heic'), false);
  assert.equal(esMimeImagenSoportado('application/pdf'), false);
  assert.equal(esMimeImagenSoportado(undefined), false);
});

// ---- interpretarImagen ----

const mockClient = (t, parseImpl) => {
  const fakeClient = { responses: { parse: parseImpl } };
  t.mock.method(openaiService, 'getClient', () => fakeClient);
  return fakeClient;
};

const IMAGEN = Buffer.from('fake-jpeg-bytes');

test('manda la imagen como input_image en base64 con detalle alto, la leyenda y el emisor', async (t) => {
  let paramsRecibidos;
  mockClient(t, async (params) => {
    paramsRecibidos = params;
    return { output_parsed: salidaBase() };
  });

  const salida = await interpretarImagen({ buffer: IMAGEN, mimeType: 'image/jpeg', leyenda: 'es a crédito', emisor: EMISOR });

  assert.deepEqual(salida, salidaBase());
  const contenido = paramsRecibidos.input[1].content;
  const imagen = contenido.find((parte) => parte.type === 'input_image');
  const texto = contenido.find((parte) => parte.type === 'input_text');
  assert.equal(imagen.image_url, `data:image/jpeg;base64,${IMAGEN.toString('base64')}`);
  assert.equal(imagen.detail, 'high');
  assert.match(texto.text, /es a crédito/);
  assert.match(texto.text, /80000000-1/);
  assert.equal(paramsRecibidos.store, false);
});

test('formato no soportado o imagen vacía se rechazan sin llamar a OpenAI', async (t) => {
  const parse = t.mock.fn(async () => ({ output_parsed: salidaBase() }));
  mockClient(t, parse);

  await assert.rejects(
    () => interpretarImagen({ buffer: IMAGEN, mimeType: 'application/pdf', emisor: EMISOR }),
    (err) => err instanceof OpenAIServiceError && err.type === 'INVALID_INPUT',
  );
  await assert.rejects(
    () => interpretarImagen({ buffer: Buffer.alloc(0), mimeType: 'image/png', emisor: EMISOR }),
    (err) => err instanceof OpenAIServiceError && err.type === 'INVALID_INPUT',
  );
  assert.equal(parse.mock.callCount(), 0);
});

test('error transitorio se reintenta una vez', async (t) => {
  let intentos = 0;
  mockClient(t, async () => {
    intentos += 1;
    if (intentos === 1) {
      const err = new Error('server error');
      err.status = 503;
      throw err;
    }
    return { output_parsed: salidaBase() };
  });

  await interpretarImagen({ buffer: IMAGEN, mimeType: 'image/png', emisor: EMISOR });
  assert.equal(intentos, 2);
});

test('salida que no cumple el esquema se mapea a INVALID_OUTPUT', async (t) => {
  mockClient(t, async () => ({ output_parsed: { ...salidaBase(), condicionVenta: 'FIADO' } }));

  await assert.rejects(
    () => interpretarImagen({ buffer: IMAGEN, mimeType: 'image/png', emisor: EMISOR }),
    (err) => err instanceof OpenAIServiceError && err.type === 'INVALID_OUTPUT',
  );
});
