const test = require('node:test');
const assert = require('node:assert/strict');
const { esSaludoPuro, normalizarTexto, normalizarTelefono } = require('../../src/utils/texto');

test('esSaludoPuro detecta variantes exactas de saludo', () => {
  assert.equal(esSaludoPuro('Hola'), true);
  assert.equal(esSaludoPuro('holaa'), true);
  assert.equal(esSaludoPuro('Buen día!'), true);
  assert.equal(esSaludoPuro('buenas tardes'), true);
});

test('esSaludoPuro tolera repeticiones, alargamientos y puntuación variada', () => {
  assert.equal(esSaludoPuro('Hola hola!!'), true);
  assert.equal(esSaludoPuro('Holaaaa'), true);
  assert.equal(esSaludoPuro('hola, hola'), true);
  assert.equal(esSaludoPuro('¡¡¡Hola!!!'), true);
  assert.equal(esSaludoPuro('Heey'), true);
  assert.equal(esSaludoPuro('Que tal'), true);
  assert.equal(esSaludoPuro('Holis'), true);
});

test('esSaludoPuro no dispara si el mensaje incluye además una solicitud', () => {
  assert.equal(esSaludoPuro('Hola, quiero emitir una factura para Diego Larrea'), false);
  assert.equal(esSaludoPuro('Hola, cuánto sale un peluche'), false);
});

test('esSaludoPuro trata texto vacío/nulo como ausencia de saludo', () => {
  assert.equal(esSaludoPuro(''), false);
  assert.equal(esSaludoPuro(null), false);
  assert.equal(esSaludoPuro(undefined), false);
});

test('normalizarTexto colapsa espacios y recorta, o devuelve null', () => {
  assert.equal(normalizarTexto('  Diego   Larrea  '), 'Diego Larrea');
  assert.equal(normalizarTexto(''), null);
  assert.equal(normalizarTexto(null), null);
  assert.equal(normalizarTexto(undefined), null);
});

test('normalizarTelefono deja solo dígitos', () => {
  assert.equal(normalizarTelefono('+595 981 234-567'), '595981234567');
});
