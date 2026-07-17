const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../../src/utils/prisma');
const conversacionService = require('../../src/services/conversacion.service');
const { mockProp } = require('../helpers/spy');

test('getOrCreateAbierta devuelve la conversación existente si ya hay una ABIERTA', async (t) => {
  mockProp(t, prisma.conversacion, 'findFirst', async () => ({ id: 1, estado: 'ABIERTA' }));
  const createSpy = mockProp(t, prisma.conversacion, 'create', async () => {
    throw new Error('no debería crearse una nueva conversación');
  });

  const conversacion = await conversacionService.getOrCreateAbierta(1);

  assert.equal(conversacion.id, 1);
  assert.equal(createSpy.calls.length, 0);
});

test('caso 15: carrera al crear conversación recupera la creada por el otro proceso', async (t) => {
  let primeraLlamada = true;
  mockProp(t, prisma.conversacion, 'findFirst', async () => {
    if (primeraLlamada) {
      primeraLlamada = false;
      return null;
    }
    return { id: 99, estado: 'ABIERTA' };
  });

  mockProp(t, prisma.conversacion, 'create', async () => {
    const error = new Error('Unique constraint failed');
    error.code = 'P2002';
    throw error;
  });

  const conversacion = await conversacionService.getOrCreateAbierta(1);

  assert.equal(conversacion.id, 99);
});

test('getOrCreateAbierta propaga errores que no son de restricción única', async (t) => {
  mockProp(t, prisma.conversacion, 'findFirst', async () => null);
  mockProp(t, prisma.conversacion, 'create', async () => {
    throw new Error('fallo de conexión');
  });

  await assert.rejects(() => conversacionService.getOrCreateAbierta(1), /fallo de conexión/);
});
