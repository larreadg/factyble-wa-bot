const test = require('node:test');
const assert = require('node:assert/strict');

const RUTA_ENV = require.resolve('../../src/utils/env');

// env.js lee process.env al cargarse: se recarga el módulo con el valor a probar y se restaura
// todo al terminar, para no afectar a otros tests.
const cargarEnvCon = (t, valor) => {
  const original = process.env.IMAGEN_RAFAGA_VENTANA_MS;
  if (valor === undefined) delete process.env.IMAGEN_RAFAGA_VENTANA_MS;
  else process.env.IMAGEN_RAFAGA_VENTANA_MS = valor;

  delete require.cache[RUTA_ENV];
  const env = require(RUTA_ENV);

  t.after(() => {
    if (original === undefined) delete process.env.IMAGEN_RAFAGA_VENTANA_MS;
    else process.env.IMAGEN_RAFAGA_VENTANA_MS = original;
    delete require.cache[RUTA_ENV];
  });

  return env;
};

test('IMAGEN_RAFAGA_VENTANA_MS: sin definir, vacía o inválida cae al default (nunca 0 ni NaN)', (t) => {
  for (const valor of [undefined, '', '   ', 'abc', '-5', '1.5']) {
    assert.equal(cargarEnvCon(t, valor).IMAGEN_RAFAGA_VENTANA_MS, 4000, `valor ${JSON.stringify(valor)}`);
  }
});

test('IMAGEN_RAFAGA_VENTANA_MS: respeta un entero válido, incluido 0 explícito', (t) => {
  assert.equal(cargarEnvCon(t, '6000').IMAGEN_RAFAGA_VENTANA_MS, 6000);
  assert.equal(cargarEnvCon(t, '0').IMAGEN_RAFAGA_VENTANA_MS, 0);
});
