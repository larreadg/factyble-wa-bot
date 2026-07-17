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
