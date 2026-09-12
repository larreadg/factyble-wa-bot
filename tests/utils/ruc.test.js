const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizarRuc, calcularDigitoVerificador } = require('../../src/utils/ruc');

test('normalizarRuc acepta formato NNN...-D con DV correcto', () => {
  assert.deepEqual(normalizarRuc('5249657-0'), { valor: '5249657-0', invalido: false, motivo: null });
});

test('normalizarRuc quita espacios', () => {
  assert.deepEqual(normalizarRuc(' 5249657-0 '), { valor: '5249657-0', invalido: false, motivo: null });
});

test('normalizarRuc trata null/vacío como ausente, no inválido', () => {
  assert.deepEqual(normalizarRuc(null), { valor: null, invalido: false, motivo: null });
  assert.deepEqual(normalizarRuc(''), { valor: null, invalido: false, motivo: null });
  assert.deepEqual(normalizarRuc('   '), { valor: null, invalido: false, motivo: null });
});

test('normalizarRuc marca formato inválido', () => {
  assert.deepEqual(normalizarRuc('abc'), { valor: null, invalido: true, motivo: 'formato' });
  assert.deepEqual(normalizarRuc('12345'), { valor: null, invalido: true, motivo: 'formato' });
});

// El caso real que motivó la validación: "5808589-2" se tipeó por "5878589-2" (un 7 como 0). El DV
// informado es el del RUC correcto, así que el Módulo 11 lo delata; sin esto el número llegaba al
// backend, SIFEN respondía que no existe y la degradación resolvía la cédula 5808589, que existe y
// es de otra persona.
test('normalizarRuc rechaza un RUC cuyo dígito verificador no cierra', () => {
  assert.deepEqual(normalizarRuc('5808589-2'), { valor: null, invalido: true, motivo: 'dv' });
  assert.deepEqual(normalizarRuc('5878589-3'), { valor: null, invalido: true, motivo: 'dv' });
});

test('normalizarRuc acepta el RUC correcto del mismo caso', () => {
  assert.deepEqual(normalizarRuc('5878589-2'), { valor: '5878589-2', invalido: false, motivo: null });
});

// Valores verificados contra el padrón real (mismos que documenta factyble-back en facturaService).
test('calcularDigitoVerificador coincide con el algoritmo de la SET', () => {
  assert.equal(calcularDigitoVerificador('80000002'), 1);
  assert.equal(calcularDigitoVerificador('4787587'), 9);
  assert.equal(calcularDigitoVerificador('3502953'), 6);
  assert.equal(calcularDigitoVerificador('5851866'), 5);
  assert.equal(calcularDigitoVerificador('5878589'), 2);
  assert.equal(calcularDigitoVerificador('5808589'), 0);
});
