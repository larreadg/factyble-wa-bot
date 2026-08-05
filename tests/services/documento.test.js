const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../../src/utils/prisma');
const documentoService = require('../../src/services/documento.service');
const { mockProp } = require('../helpers/spy');

test('registrarEmision: crea el documento con los campos dados, usando null para los opcionales ausentes', async (t) => {
  const createSpy = mockProp(t, prisma.documento, 'create', async ({ data }) => ({ id: 1, ...data }));

  await documentoService.registrarEmision({
    empresaId: 1,
    numeroTelefono: '595981234567',
    tipo: 'FACTURA',
    cdc: 'cdc-1',
    pdfNombre: 'factura.pdf',
    numeroDocumentoFormateado: '001-001-0000001',
    clienteNombre: 'Juan Pérez',
    clienteDocumento: '4123456-7',
    estadoSifen: 'FIRMADO',
    sifenEstadoMensaje: null,
  });

  assert.equal(createSpy.calls.length, 1);
  assert.deepEqual(createSpy.calls[0][0].data, {
    empresaId: 1,
    numeroTelefono: '595981234567',
    tipo: 'FACTURA',
    cdc: 'cdc-1',
    pdfNombre: 'factura.pdf',
    numeroDocumentoFormateado: '001-001-0000001',
    clienteNombre: 'Juan Pérez',
    clienteDocumento: '4123456-7',
    estadoSifen: 'FIRMADO',
    sifenEstadoMensaje: null,
  });
});

test('registrarEmision: campos opcionales ausentes se guardan como null, no undefined', async (t) => {
  const createSpy = mockProp(t, prisma.documento, 'create', async ({ data }) => ({ id: 1, ...data }));

  await documentoService.registrarEmision({ empresaId: 1, numeroTelefono: '595981234567', tipo: 'NOTA_CREDITO', cdc: 'cdc-2' });

  assert.equal(createSpy.calls[0][0].data.pdfNombre, null);
  assert.equal(createSpy.calls[0][0].data.numeroDocumentoFormateado, null);
  assert.equal(createSpy.calls[0][0].data.clienteNombre, null);
  assert.equal(createSpy.calls[0][0].data.clienteDocumento, null);
  assert.equal(createSpy.calls[0][0].data.estadoSifen, null);
  assert.equal(createSpy.calls[0][0].data.sifenEstadoMensaje, null);
});

test('registrarCancelacion: actualiza por cdc el estadoSifen y sifenEstadoMensaje', async (t) => {
  const updateSpy = mockProp(t, prisma.documento, 'updateMany', async () => ({ count: 1 }));

  await documentoService.registrarCancelacion('cdc-1', { estadoSifen: 'CANCELADO', sifenEstadoMensaje: 'Transacción aprobada' });

  assert.equal(updateSpy.calls.length, 1);
  assert.deepEqual(updateSpy.calls[0][0], {
    where: { cdc: 'cdc-1' },
    data: { estadoSifen: 'CANCELADO', sifenEstadoMensaje: 'Transacción aprobada' },
  });
});

test('registrarCancelacion: cdc sin fila previa (documento anterior a este modelo) no lanza error', async (t) => {
  mockProp(t, prisma.documento, 'updateMany', async () => ({ count: 0 }));

  await assert.doesNotReject(() => documentoService.registrarCancelacion('cdc-inexistente', { estadoSifen: 'CANCELADO', sifenEstadoMensaje: null }));
});

test('actualizarEstados: actualiza cada ítem del batch por (empresaId, cdc)', async (t) => {
  const updateSpy = mockProp(t, prisma.documento, 'updateMany', async () => ({ count: 1 }));

  const resultados = await documentoService.actualizarEstados([
    { empresaId: 1, cdc: 'cdc-1', estadoSifen: 'APROBADO', sifenEstadoMensaje: null },
    { empresaId: 2, cdc: 'cdc-2', estadoSifen: 'RECHAZADO', sifenEstadoMensaje: 'RUC inválido' },
  ]);

  assert.equal(updateSpy.calls.length, 2);
  assert.deepEqual(updateSpy.calls[0][0], {
    where: { empresaId: 1, cdc: 'cdc-1' },
    data: { estadoSifen: 'APROBADO', sifenEstadoMensaje: null },
  });
  assert.deepEqual(updateSpy.calls[1][0], {
    where: { empresaId: 2, cdc: 'cdc-2' },
    data: { estadoSifen: 'RECHAZADO', sifenEstadoMensaje: 'RUC inválido' },
  });
  assert.deepEqual(resultados, [{ count: 1 }, { count: 1 }]);
});

test('actualizarEstados: un cdc sin fila que le corresponda (count 0) no rompe el resto del batch', async (t) => {
  let llamada = 0;
  mockProp(t, prisma.documento, 'updateMany', async () => {
    llamada += 1;
    return { count: llamada === 1 ? 0 : 1 };
  });

  const resultados = await documentoService.actualizarEstados([
    { empresaId: 1, cdc: 'cdc-inexistente', estadoSifen: 'APROBADO' },
    { empresaId: 2, cdc: 'cdc-2', estadoSifen: 'APROBADO' },
  ]);

  assert.deepEqual(resultados, [{ count: 0 }, { count: 1 }]);
});
