const test = require('node:test');
const assert = require('node:assert/strict');
const documentoNotificacionService = require('../../src/services/documentoNotificacion.service');
const facturaApiService = require('../../src/services/facturaApi.service');
const whatsappService = require('../../src/services/whatsapp.service');

const DOCUMENTO = {
  id: 1,
  numeroTelefono: '595981234567',
  tipo: 'FACTURA',
  cdc: 'cdc-1',
  pdfNombre: 'b3c1-uuid.pdf',
  numeroDocumentoFormateado: '001-001-0000045',
  estadoSifen: 'FIRMADO',
  sifenEstadoMensaje: null,
};

test('enviarPdf: descarga el PDF público, lo sube a WhatsApp y lo envía con el numeroDocumentoFormateado como caption', async (t) => {
  const descargarSpy = t.mock.method(facturaApiService, 'descargarPdf', async () => Buffer.from('contenido-pdf'));
  const uploadSpy = t.mock.method(whatsappService, 'uploadMedia', async () => ({ id: 'media-123' }));
  const enviarSpy = t.mock.method(whatsappService, 'sendDocumentMessage', async () => ({ messages: [{ id: 'wamid.1' }] }));

  await documentoNotificacionService.enviarPdf(DOCUMENTO);

  assert.equal(descargarSpy.mock.calls[0].arguments[0], 'b3c1-uuid.pdf');
  assert.equal(uploadSpy.mock.calls[0].arguments[1], 'b3c1-uuid.pdf');
  assert.equal(uploadSpy.mock.calls[0].arguments[2], 'application/pdf');

  assert.equal(enviarSpy.mock.calls[0].arguments[0], '595981234567');
  const { caption, ...resto } = enviarSpy.mock.calls[0].arguments[1];
  assert.deepEqual(resto, { id: 'media-123', filename: 'b3c1-uuid.pdf' });
  assert.ok(caption.includes('Factura emitida'));
  assert.ok(caption.includes('001-001-0000045'));
});

test('enviarPdf: una nota de crédito usa la etiqueta correcta en el caption', async (t) => {
  t.mock.method(facturaApiService, 'descargarPdf', async () => Buffer.from('contenido-pdf'));
  t.mock.method(whatsappService, 'uploadMedia', async () => ({ id: 'media-123' }));
  const enviarSpy = t.mock.method(whatsappService, 'sendDocumentMessage', async () => ({ messages: [{ id: 'wamid.1' }] }));

  await documentoNotificacionService.enviarPdf({ ...DOCUMENTO, tipo: 'NOTA_CREDITO' });

  assert.ok(enviarSpy.mock.calls[0].arguments[1].caption.includes('Nota de crédito emitida'));
});

test('enviarPdf sin pdfNombre: no intenta descargar ni subir nada, y lanza (para que el caller use el fallback)', async (t) => {
  const descargarSpy = t.mock.method(facturaApiService, 'descargarPdf', async () => {
    throw new Error('no debería llamarse');
  });

  await assert.rejects(() => documentoNotificacionService.enviarPdf({ ...DOCUMENTO, pdfNombre: null }));
  assert.equal(descargarSpy.mock.callCount(), 0);
});
