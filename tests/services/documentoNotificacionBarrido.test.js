const test = require('node:test');
const assert = require('node:assert/strict');
const barrido = require('../../src/services/documentoNotificacionBarrido.service');
const documentoService = require('../../src/services/documento.service');
const documentoNotificacionService = require('../../src/services/documentoNotificacion.service');

const doc = (cdc) => ({ cdc, tipo: 'FACTURA', numeroTelefono: '595994803097', pdfNombre: `${cdc}.pdf` });

test('sin documentos pendientes: no intenta enviar nada', async (t) => {
  t.mock.method(documentoService, 'listarPendientesDeNotificar', async () => []);
  const enviarSpy = t.mock.method(documentoNotificacionService, 'enviarPdf', async () => {});
  const marcarSpy = t.mock.method(documentoService, 'marcarNotificado', async () => {});

  await barrido.ejecutar();

  assert.equal(enviarSpy.mock.callCount(), 0);
  assert.equal(marcarSpy.mock.callCount(), 0);
});

test('entrega cada pendiente y lo marca notificado', async (t) => {
  t.mock.method(documentoService, 'listarPendientesDeNotificar', async () => [doc('cdc-1'), doc('cdc-2')]);
  const enviarSpy = t.mock.method(documentoNotificacionService, 'enviarPdf', async () => {});
  const marcarSpy = t.mock.method(documentoService, 'marcarNotificado', async () => {});

  await barrido.ejecutar();

  assert.equal(enviarSpy.mock.callCount(), 2);
  assert.equal(marcarSpy.mock.callCount(), 2);
  assert.deepEqual(marcarSpy.mock.calls.map((c) => c.arguments[0]), ['cdc-1', 'cdc-2']);
});

test('si un envío falla, no lo marca notificado y sigue con el resto', async (t) => {
  t.mock.method(documentoService, 'listarPendientesDeNotificar', async () => [doc('falla'), doc('ok')]);
  const enviarSpy = t.mock.method(documentoNotificacionService, 'enviarPdf', async (documento) => {
    if (documento.cdc === 'falla') throw new Error('WhatsApp caído');
  });
  const marcarSpy = t.mock.method(documentoService, 'marcarNotificado', async () => {});

  await barrido.ejecutar();

  assert.equal(enviarSpy.mock.callCount(), 2);
  // Solo el que se envió OK se marca notificado; el que falló queda pendiente.
  assert.equal(marcarSpy.mock.callCount(), 1);
  assert.equal(marcarSpy.mock.calls[0].arguments[0], 'ok');
});

test('un error listando no propaga (no debe tumbar el proceso del webhook)', async (t) => {
  t.mock.method(documentoService, 'listarPendientesDeNotificar', async () => {
    throw new Error('DB caída');
  });
  const enviarSpy = t.mock.method(documentoNotificacionService, 'enviarPdf', async () => {});

  await assert.doesNotReject(() => barrido.ejecutar());
  assert.equal(enviarSpy.mock.callCount(), 0);
});
