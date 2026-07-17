const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizarRuc } = require('../../src/utils/ruc');

test('normalizarRuc acepta formato NNN...-D', () => {
  assert.deepEqual(normalizarRuc('5249657-0'), { valor: '5249657-0', invalido: false });
});

test('normalizarRuc quita espacios', () => {
  assert.deepEqual(normalizarRuc(' 5249657-0 '), { valor: '5249657-0', invalido: false });
});

test('normalizarRuc trata null/vacío como ausente, no inválido', () => {
  assert.deepEqual(normalizarRuc(null), { valor: null, invalido: false });
  assert.deepEqual(normalizarRuc(''), { valor: null, invalido: false });
  assert.deepEqual(normalizarRuc('   '), { valor: null, invalido: false });
});

test('normalizarRuc marca formato inválido', () => {
  assert.deepEqual(normalizarRuc('abc'), { valor: null, invalido: true });
  assert.deepEqual(normalizarRuc('12345'), { valor: null, invalido: true });
});
