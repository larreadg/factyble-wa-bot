const test = require('node:test');
const assert = require('node:assert/strict');
const barrido = require('../../src/services/emisionReintento.service');
const sesionConversacionalService = require('../../src/services/sesionConversacional.service');
const botOrchestrator = require('../../src/services/botOrchestrator.service');

const sesion = (id) => ({ id, datosTemporales: {} });

test('sin sesiones pendientes: no reintenta nada', async (t) => {
  t.mock.method(sesionConversacionalService, 'listarEmisionesPendientesDeReintento', async () => []);
  const reintentarSpy = t.mock.method(botOrchestrator, 'reintentarEmisionPendiente', async () => {});

  await barrido.ejecutar();

  assert.equal(reintentarSpy.mock.callCount(), 0);
});

test('reintenta cada sesión pendiente vencida', async (t) => {
  t.mock.method(sesionConversacionalService, 'listarEmisionesPendientesDeReintento', async () => [sesion(1), sesion(2)]);
  const reintentarSpy = t.mock.method(botOrchestrator, 'reintentarEmisionPendiente', async () => {});

  await barrido.ejecutar();

  assert.equal(reintentarSpy.mock.callCount(), 2);
  assert.deepEqual(reintentarSpy.mock.calls.map((c) => c.arguments[0].id), [1, 2]);
});

test('si el reintento de una sesión tira, no aborta el resto del lote', async (t) => {
  t.mock.method(sesionConversacionalService, 'listarEmisionesPendientesDeReintento', async () => [sesion(1), sesion(2)]);
  const reintentarSpy = t.mock.method(botOrchestrator, 'reintentarEmisionPendiente', async (s) => {
    if (s.id === 1) throw new Error('falló ese reintento');
  });

  await assert.doesNotReject(() => barrido.ejecutar());
  assert.equal(reintentarSpy.mock.callCount(), 2);
});

test('un error listando no propaga (no debe tumbar el proceso del webhook)', async (t) => {
  t.mock.method(sesionConversacionalService, 'listarEmisionesPendientesDeReintento', async () => {
    throw new Error('DB caída');
  });
  const reintentarSpy = t.mock.method(botOrchestrator, 'reintentarEmisionPendiente', async () => {});

  await assert.doesNotReject(() => barrido.ejecutar());
  assert.equal(reintentarSpy.mock.callCount(), 0);
});
