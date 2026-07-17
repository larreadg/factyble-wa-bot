const test = require('node:test');
const assert = require('node:assert/strict');
const { extraerCdc } = require('../../src/utils/cdc');

const CDC_VALIDO = '01800695921001001000000012024071410238123456';

test('extrae un CDC de 44 dígitos pegado, sin nada más en el mensaje', () => {
  const { cdc, candidatoInvalido } = extraerCdc(CDC_VALIDO);
  assert.equal(cdc, CDC_VALIDO);
  assert.equal(candidatoInvalido, null);
});

test('extrae el CDC aunque venga con espacios (copiado del KuDE)', () => {
  const conEspacios = '0180 0695 9210 0100 1000 0000 1202 4071 4102 3812 3456';
  const { cdc } = extraerCdc(conEspacios);
  assert.equal(cdc, CDC_VALIDO);
});

test('extrae el CDC aunque venga con saltos de línea', () => {
  const conSaltos = `${CDC_VALIDO.slice(0, 20)}\n${CDC_VALIDO.slice(20)}`;
  const { cdc } = extraerCdc(conSaltos);
  assert.equal(cdc, CDC_VALIDO);
});

test('CDC en medio de una frase con otros números cortos no se confunde', () => {
  const { cdc } = extraerCdc(`El cdc es ${CDC_VALIDO}, quiero acreditar 2 sillas a 50000 cada una`);
  assert.equal(cdc, CDC_VALIDO);
});

test('candidato con largo incorrecto (40 dígitos) se marca como inválido, no se confunde con un cdc válido', () => {
  const candidato40 = CDC_VALIDO.slice(0, 40);
  const { cdc, candidatoInvalido } = extraerCdc(candidato40);
  assert.equal(cdc, null);
  assert.equal(candidatoInvalido, candidato40);
});

test('sin ningún número largo, no hay cdc ni candidato inválido', () => {
  const { cdc, candidatoInvalido } = extraerCdc('quiero acreditar 2 sillas a 50000 cada una');
  assert.equal(cdc, null);
  assert.equal(candidatoInvalido, null);
});

test('números cortos sueltos (cantidades/precios) no se marcan como candidato inválido', () => {
  const { cdc, candidatoInvalido } = extraerCdc('2 sillas a 50000 cada una, total 100000');
  assert.equal(cdc, null);
  assert.equal(candidatoInvalido, null);
});

test('texto vacío o no-string no rompe', () => {
  assert.deepEqual(extraerCdc(''), { cdc: null, candidatoInvalido: null });
  assert.deepEqual(extraerCdc(null), { cdc: null, candidatoInvalido: null });
  assert.deepEqual(extraerCdc(undefined), { cdc: null, candidatoInvalido: null });
});
