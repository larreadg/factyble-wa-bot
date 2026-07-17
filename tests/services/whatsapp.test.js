const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET || 'test-secret';
const whatsappService = require('../../src/services/whatsapp.service');
const env = require('../../src/utils/env');

test('verifySignature acepta una firma HMAC-SHA256 válida', () => {
  const body = Buffer.from(JSON.stringify({ hello: 'world' }));
  const firma = `sha256=${crypto.createHmac('sha256', env.WHATSAPP_APP_SECRET).update(body).digest('hex')}`;

  assert.equal(whatsappService.verifySignature(body, firma), true);
});

test('verifySignature rechaza una firma inválida', () => {
  const body = Buffer.from(JSON.stringify({ hello: 'world' }));
  assert.equal(whatsappService.verifySignature(body, 'sha256=firma-incorrecta'), false);
});

test('verifySignature rechaza cuando falta la cabecera o el cuerpo', () => {
  assert.equal(whatsappService.verifySignature(Buffer.from('{}'), null), false);
  assert.equal(whatsappService.verifySignature(null, 'sha256=algo'), false);
});
