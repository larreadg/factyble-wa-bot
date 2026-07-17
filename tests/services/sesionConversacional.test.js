const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../../src/utils/prisma');
const sesionConversacionalService = require('../../src/services/sesionConversacional.service');
const { ESTADOS_SESION } = require('../../src/utils/constants');
const { mockProp } = require('../helpers/spy');

test('caso 9: transicionar aplica el cambio cuando el estado actual coincide', async (t) => {
  mockProp(t, prisma.sesionConversacional, 'updateMany', async () => ({ count: 1 }));
  mockProp(t, prisma.sesionConversacional, 'findUnique', async () => ({ id: 1, estado: ESTADOS_SESION.PROCESANDO }));

  const resultado = await sesionConversacionalService.transicionar(
    1,
    [ESTADOS_SESION.ESPERANDO_CONFIRMACION],
    ESTADOS_SESION.PROCESANDO,
    { version: 1 },
  );

  assert.ok(resultado);
  assert.equal(resultado.estado, ESTADOS_SESION.PROCESANDO);
});

test('caso 10: transicionar no aplica el cambio si el estado ya cambió (segunda confirmación concurrente)', async (t) => {
  mockProp(t, prisma.sesionConversacional, 'updateMany', async () => ({ count: 0 }));
  const findUniqueSpy = mockProp(t, prisma.sesionConversacional, 'findUnique', async () => ({}));

  const resultado = await sesionConversacionalService.transicionar(
    1,
    [ESTADOS_SESION.ESPERANDO_CONFIRMACION],
    ESTADOS_SESION.PROCESANDO,
    { version: 1 },
  );

  assert.equal(resultado, null);
  assert.equal(findUniqueSpy.calls.length, 0, 'no debe volver a leer la sesión si la transición no tuvo efecto');
});

test('transicionar usa el where con estado IN los estados de origen permitidos', async (t) => {
  let whereRecibido = null;
  mockProp(t, prisma.sesionConversacional, 'updateMany', async ({ where }) => {
    whereRecibido = where;
    return { count: 1 };
  });
  mockProp(t, prisma.sesionConversacional, 'findUnique', async () => ({ id: 5 }));

  await sesionConversacionalService.transicionar(
    5,
    [ESTADOS_SESION.INICIO, ESTADOS_SESION.CAPTURANDO_DATOS],
    ESTADOS_SESION.ESPERANDO_CONFIRMACION,
    {},
  );

  assert.equal(whereRecibido.id, 5);
  assert.deepEqual(whereRecibido.estado.in, [ESTADOS_SESION.INICIO, ESTADOS_SESION.CAPTURANDO_DATOS]);
});

test('resetSesion vuelve a INICIO con un borrador vacío', async (t) => {
  let dataRecibida = null;
  mockProp(t, prisma.sesionConversacional, 'update', async ({ data }) => {
    dataRecibida = data;
    return { id: 1, ...data };
  });

  await sesionConversacionalService.resetSesion(1);

  assert.equal(dataRecibida.estado, ESTADOS_SESION.INICIO);
  assert.equal(dataRecibida.intencionActual, null);
  assert.equal(dataRecibida.datosTemporales.items.length, 0);
});

test('getOrCreateSesion hace upsert por conversacionId con estado INICIO por defecto', async (t) => {
  let argsRecibidos = null;
  mockProp(t, prisma.sesionConversacional, 'upsert', async (args) => {
    argsRecibidos = args;
    return { id: 1, ...args.create };
  });

  const sesion = await sesionConversacionalService.getOrCreateSesion(42);

  assert.equal(argsRecibidos.where.conversacionId, 42);
  assert.equal(argsRecibidos.create.estado, ESTADOS_SESION.INICIO);
  assert.equal(sesion.estado, ESTADOS_SESION.INICIO);
});
