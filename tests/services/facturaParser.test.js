const test = require('node:test');
const assert = require('node:assert/strict');
const openaiService = require('../../src/services/openai.service');
const facturaParserService = require('../../src/services/facturaParser.service');
const { OpenAIServiceError } = require('../../src/services/openai.errors');

const validOutput = {
  accion: 'CREAR_O_ACTUALIZAR_BORRADOR',
  factura: {
    cliente: { nombre: 'Diego Larrea', tipoDocumento: 'RUC', numeroDocumento: '5249657-0' },
    condicionVenta: 'CONTADO',
    items: [{ descripcion: 'Borrador', cantidad: 1, precioUnitario: 5000, tasa: '10%' }],
  },
  camposFaltantes: [],
  advertencias: [],
  confianza: 0.9,
};

const mockClient = (t, parseImpl) => {
  const fakeClient = { responses: { parse: parseImpl } };
  t.mock.method(openaiService, 'getClient', () => fakeClient);
  return fakeClient;
};

test('caso 16: timeout se mapea a OpenAIServiceError tipo TIMEOUT tras un reintento', async (t) => {
  let intentos = 0;
  mockClient(t, async () => {
    intentos += 1;
    const err = new Error('timeout');
    err.name = 'APIConnectionTimeoutError';
    throw err;
  });

  await assert.rejects(
    () => facturaParserService.interpretar({ mensajeUsuario: 'hola quiero una factura' }),
    (err) => err instanceof OpenAIServiceError && err.type === 'TIMEOUT',
  );
  assert.equal(intentos, 2, 'debe reintentar exactamente una vez ante error transitorio');
});

test('caso 17: rate limit (429) se mapea a OpenAIServiceError tipo RATE_LIMIT', async (t) => {
  mockClient(t, async () => {
    const err = new Error('rate limited');
    err.status = 429;
    throw err;
  });

  await assert.rejects(
    () => facturaParserService.interpretar({ mensajeUsuario: 'hola quiero una factura' }),
    (err) => err instanceof OpenAIServiceError && err.type === 'RATE_LIMIT',
  );
});

test('errores de autenticación (401) no se reintentan y se mapean a AUTH', async (t) => {
  let intentos = 0;
  mockClient(t, async () => {
    intentos += 1;
    const err = new Error('unauthorized');
    err.status = 401;
    throw err;
  });

  await assert.rejects(
    () => facturaParserService.interpretar({ mensajeUsuario: 'hola quiero una factura' }),
    (err) => err instanceof OpenAIServiceError && err.type === 'AUTH',
  );
  assert.equal(intentos, 1, 'no debe reintentar errores de autenticación');
});

test('caso 18: respuesta sin output_parsed y sin refusal se mapea a EMPTY_RESPONSE', async (t) => {
  mockClient(t, async () => ({ output_parsed: null, output: [], status: 'completed' }));

  await assert.rejects(
    () => facturaParserService.interpretar({ mensajeUsuario: 'hola quiero una factura' }),
    (err) => err instanceof OpenAIServiceError && err.type === 'EMPTY_RESPONSE',
  );
});

test('respuesta incompleta se mapea a INCOMPLETE', async (t) => {
  mockClient(t, async () => ({ output_parsed: null, output: [], status: 'incomplete' }));

  await assert.rejects(
    () => facturaParserService.interpretar({ mensajeUsuario: 'hola quiero una factura' }),
    (err) => err instanceof OpenAIServiceError && err.type === 'INCOMPLETE',
  );
});

test('caso 19: salida estructurada inválida (no cumple el esquema) se mapea a INVALID_OUTPUT', async (t) => {
  mockClient(t, async () => ({
    output_parsed: { intencion: 'ALGO_INVALIDO', accion: 'CREAR_O_ACTUALIZAR_BORRADOR' },
    output: [],
    status: 'completed',
  }));

  await assert.rejects(
    () => facturaParserService.interpretar({ mensajeUsuario: 'hola quiero una factura' }),
    (err) => err instanceof OpenAIServiceError && err.type === 'INVALID_OUTPUT',
  );
});

test('con salida válida, devuelve los datos ya validados por Zod', async (t) => {
  mockClient(t, async () => ({ output_parsed: validOutput, output: [], status: 'completed', usage: { input_tokens: 10, output_tokens: 5 } }));

  const resultado = await facturaParserService.interpretar({ mensajeUsuario: 'quiero una factura' });
  assert.deepEqual(resultado, validOutput);
});

test('caso 20/21/22: usa el modelo y prompt_cache_key configurados, sin opciones de caché incompatibles', async (t) => {
  let paramsRecibidos = null;
  mockClient(t, async (params) => {
    paramsRecibidos = params;
    return { output_parsed: validOutput, output: [], status: 'completed' };
  });

  await facturaParserService.interpretar({ mensajeUsuario: 'quiero una factura' });

  assert.equal(paramsRecibidos.model, process.env.OPENAI_MODEL || 'gpt-5.4-mini');
  assert.equal(typeof paramsRecibidos.prompt_cache_key, 'string');
  assert.ok(paramsRecibidos.prompt_cache_key.length > 0);
  assert.equal(paramsRecibidos.store, false);
  assert.equal('prompt_cache_options' in paramsRecibidos, false);
  assert.equal('prompt_cache_breakpoint' in paramsRecibidos, false);
});

test('el mensaje del usuario nunca se interpola en las instrucciones estáticas', async (t) => {
  let paramsRecibidos = null;
  mockClient(t, async (params) => {
    paramsRecibidos = params;
    return { output_parsed: validOutput, output: [], status: 'completed' };
  });

  await facturaParserService.interpretar({ mensajeUsuario: 'MENSAJE_UNICO_DE_PRUEBA_XYZ' });

  const [instrucciones, mensajeUsuario] = paramsRecibidos.input;
  assert.equal(instrucciones.role, 'developer');
  assert.equal(mensajeUsuario.role, 'user');
  assert.ok(!instrucciones.content.includes('MENSAJE_UNICO_DE_PRUEBA_XYZ'));
  assert.ok(mensajeUsuario.content.includes('MENSAJE_UNICO_DE_PRUEBA_XYZ'));
});

const facturaVacia = () => ({ cliente: { nombre: null, tipoDocumento: null, numeroDocumento: null }, condicionVenta: 'CONTADO', items: [] });

for (const accion of ['SALUDO', 'CANCELAR', 'FUERA_DE_ALCANCE', 'CONFIRMAR']) {
  test(`accion=${accion} pasa la validación de Zod`, async (t) => {
    const salida = { accion, factura: facturaVacia(), camposFaltantes: [], advertencias: [], confianza: 0.9 };
    mockClient(t, async () => ({ output_parsed: salida, output: [], status: 'completed' }));

    const resultado = await facturaParserService.interpretar({ mensajeUsuario: 'cualquier mensaje' });
    assert.equal(resultado.accion, accion);
  });
}

test('cliente.tipoDocumento="CI" pasa la validación de Zod', async (t) => {
  const salida = {
    accion: 'CREAR_O_ACTUALIZAR_BORRADOR',
    factura: {
      cliente: { nombre: 'Arnaldo Larrea', tipoDocumento: 'CI', numeroDocumento: '1597455' },
      condicionVenta: 'CONTADO',
      items: [{ descripcion: 'Kg de pan', cantidad: 1, precioUnitario: 10000, tasa: '10%' }],
    },
    camposFaltantes: [],
    advertencias: [],
    confianza: 0.9,
  };
  mockClient(t, async () => ({ output_parsed: salida, output: [], status: 'completed' }));

  const resultado = await facturaParserService.interpretar({ mensajeUsuario: 'cualquier mensaje' });
  assert.equal(resultado.factura.cliente.tipoDocumento, 'CI');
  assert.equal(resultado.factura.cliente.numeroDocumento, '1597455');
});

test('accion desconocida (fuera del enum) se rechaza como INVALID_OUTPUT', async (t) => {
  mockClient(t, async () => ({
    output_parsed: { accion: 'ALGO_INVALIDO', factura: facturaVacia(), camposFaltantes: [], advertencias: [], confianza: 0.5 },
    output: [],
    status: 'completed',
  }));

  await assert.rejects(
    () => facturaParserService.interpretar({ mensajeUsuario: 'cualquier mensaje' }),
    (err) => err instanceof OpenAIServiceError && err.type === 'INVALID_OUTPUT',
  );
});
