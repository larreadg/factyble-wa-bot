const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../../src/utils/prisma');
const mensajeService = require('../../src/services/mensaje.service');
const { mockProp } = require('../helpers/spy');

test('caso 14: registrarEntrante detecta un whatsappMensajeId duplicado sin crear un segundo registro', async (t) => {
  mockProp(t, prisma.mensaje, 'create', async () => {
    const error = new Error('Unique constraint failed on whatsapp_mensaje_id');
    error.code = 'P2002';
    throw error;
  });
  mockProp(t, prisma.mensaje, 'findUnique', async () => ({ id: 5, whatsappMensajeId: 'wamid.123' }));

  const { mensaje, duplicado } = await mensajeService.registrarEntrante({
    conversacionId: 1,
    whatsappMensajeId: 'wamid.123',
    tipo: 'TEXTO',
    contenidoTexto: 'hola',
    fechaMensaje: new Date(),
  });

  assert.equal(duplicado, true);
  assert.equal(mensaje.id, 5);
});

test('registrarEntrante crea el mensaje cuando no existe todavía', async (t) => {
  mockProp(t, prisma.mensaje, 'create', async ({ data }) => ({ id: 1, ...data }));

  const { mensaje, duplicado } = await mensajeService.registrarEntrante({
    conversacionId: 1,
    whatsappMensajeId: 'wamid.nuevo',
    tipo: 'TEXTO',
    contenidoTexto: 'hola',
    fechaMensaje: new Date(),
  });

  assert.equal(duplicado, false);
  assert.equal(mensaje.direccion, 'ENTRANTE');
  assert.equal(mensaje.estado, 'RECIBIDO');
});

test('actualizarEstadoPorWhatsappId actualiza el estado de entrega/lectura', async (t) => {
  let argsRecibidos = null;
  mockProp(t, prisma.mensaje, 'updateMany', async (args) => {
    argsRecibidos = args;
    return { count: 1 };
  });

  await mensajeService.actualizarEstadoPorWhatsappId('wamid.out', 'LEIDO');

  assert.equal(argsRecibidos.where.whatsappMensajeId, 'wamid.out');
  assert.equal(argsRecibidos.data.estado, 'LEIDO');
});

test('listarImagenesEntrantesEntre filtra fotos entrantes de la conversación por hora de recepción', async (t) => {
  const findMany = mockProp(t, prisma.mensaje, 'findMany', async () => [{ id: 1 }]);
  const desde = new Date('2026-11-14T12:00:00.000Z');
  const hasta = new Date('2026-11-14T12:00:08.000Z');

  const fechaMensajeMinima = new Date('2026-11-14T11:45:00.000Z');

  const resultado = await mensajeService.listarImagenesEntrantesEntre(7, desde, hasta, fechaMensajeMinima);

  assert.deepEqual(resultado, [{ id: 1 }]);
  const { where, orderBy } = findMany.calls[0][0];
  assert.deepEqual(where, {
    conversacionId: 7,
    direccion: 'ENTRANTE',
    tipo: 'IMAGEN',
    fechaCreacion: { gte: desde, lte: hasta },
    fechaMensaje: { gte: fechaMensajeMinima },
  });
  assert.deepEqual(orderBy, { id: 'asc' });
});
