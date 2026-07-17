const test = require('node:test');
const assert = require('node:assert/strict');
const { formatearGuaranies } = require('../../src/utils/moneda');

test('formatearGuaranies formatea sin decimales con separador de miles', () => {
  assert.equal(formatearGuaranies(75000), 'Gs. 75.000');
  assert.equal(formatearGuaranies(5000), 'Gs. 5.000');
  assert.equal(formatearGuaranies(0), 'Gs. 0');
});

test('formatearGuaranies redondea valores no enteros', () => {
  assert.equal(formatearGuaranies(1000.6), 'Gs. 1.001');
});
