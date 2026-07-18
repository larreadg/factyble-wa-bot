const test = require('node:test');
const assert = require('node:assert/strict');
const documentoNotificacionService = require('../../src/services/documentoNotificacion.service');
const facturaApiService = require('../../src/services/facturaApi.service');
const whatsappService = require('../../src/services/whatsapp.service');

const DOCUMENTO_APROBADO = {
  id: 1,
  numeroTelefono: '595981234567',
  tipo: 'FACTURA',
  cdc: 'cdc-1',
  pdfNombre: 'b3c1-uuid.pdf',
  numeroDocumentoFormateado: '001-001-0000045',
  estadoSifen: 'APROBADO',
  sifenEstadoMensaje: null,
};

test('APROBADO: descarga el PDF público, lo sube a WhatsApp y lo envía con el numeroDocumentoFormateado como caption', async (t) => {
  const descargarSpy = t.mock.method(facturaApiService, 'descargarPdf', async () => Buffer.from('contenido-pdf'));
  const uploadSpy = t.mock.method(whatsappService, 'uploadMedia', async () => ({ id: 'media-123' }));
  const enviarSpy = t.mock.method(whatsappService, 'sendDocumentMessage', async () => ({ messages: [{ id: 'wamid.1' }] }));

  await documentoNotificacionService.enviarPorEstado(DOCUMENTO_APROBADO);

  assert.equal(descargarSpy.mock.calls[0].arguments[0], 'b3c1-uuid.pdf');
  assert.equal(uploadSpy.mock.calls[0].arguments[1], 'b3c1-uuid.pdf');
  assert.equal(uploadSpy.mock.calls[0].arguments[2], 'application/pdf');

  assert.equal(enviarSpy.mock.calls[0].arguments[0], '595981234567');
  assert.deepEqual(enviarSpy.mock.calls[0].arguments[1], { id: 'media-123', filename: 'b3c1-uuid.pdf', caption: '001-001-0000045' });
});

test('APROBADO sin pdfNombre: no intenta descargar ni subir nada, y lanza (para no marcarse como notificado)', async (t) => {
  const descargarSpy = t.mock.method(facturaApiService, 'descargarPdf', async () => {
    throw new Error('no debería llamarse');
  });

  await assert.rejects(() => documentoNotificacionService.enviarPorEstado({ ...DOCUMENTO_APROBADO, pdfNombre: null }));
  assert.equal(descargarSpy.mock.callCount(), 0);
});

test('RECHAZADO: envía un mensaje de texto con el motivo de SIFEN', async (t) => {
  const enviarSpy = t.mock.method(whatsappService, 'sendTextMessage', async () => ({ messages: [{ id: 'wamid.1' }] }));

  await documentoNotificacionService.enviarPorEstado({
    ...DOCUMENTO_APROBADO,
    estadoSifen: 'RECHAZADO',
    sifenEstadoMensaje: 'RUC no encontrado en el padrón',
  });

  assert.equal(enviarSpy.mock.calls[0].arguments[0], '595981234567');
  assert.ok(enviarSpy.mock.calls[0].arguments[1].includes('RUC no encontrado en el padrón'));
  assert.ok(enviarSpy.mock.calls[0].arguments[1].includes('rechazada'));
});

test('RECHAZADO en una nota de crédito usa la etiqueta correcta', async (t) => {
  const enviarSpy = t.mock.method(whatsappService, 'sendTextMessage', async () => ({ messages: [{ id: 'wamid.1' }] }));

  await documentoNotificacionService.enviarPorEstado({ ...DOCUMENTO_APROBADO, tipo: 'NOTA_CREDITO', estadoSifen: 'RECHAZADO', sifenEstadoMensaje: 'motivo' });

  assert.ok(enviarSpy.mock.calls[0].arguments[1].includes('nota de crédito'));
});

test('ERROR: envía un mensaje pidiendo contactar a soporte', async (t) => {
  const enviarSpy = t.mock.method(whatsappService, 'sendTextMessage', async () => ({ messages: [{ id: 'wamid.1' }] }));

  await documentoNotificacionService.enviarPorEstado({ ...DOCUMENTO_APROBADO, estadoSifen: 'ERROR', sifenEstadoMensaje: null });

  assert.ok(enviarSpy.mock.calls[0].arguments[1].includes('wa.me/595976788698'));
});

test('estado no final (ej. FIRMADO): no envía nada', async (t) => {
  const enviarTextoSpy = t.mock.method(whatsappService, 'sendTextMessage', async () => {
    throw new Error('no debería llamarse');
  });
  const enviarDocSpy = t.mock.method(whatsappService, 'sendDocumentMessage', async () => {
    throw new Error('no debería llamarse');
  });

  await documentoNotificacionService.enviarPorEstado({ ...DOCUMENTO_APROBADO, estadoSifen: 'FIRMADO' });

  assert.equal(enviarTextoSpy.mock.callCount(), 0);
  assert.equal(enviarDocSpy.mock.callCount(), 0);
});
