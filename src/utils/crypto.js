const crypto = require('crypto');
const env = require('./env');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

const getKey = () => {
  const key = Buffer.from(env.ENCRYPTION_KEY || '', 'hex');

  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY debe ser una clave hexadecimal de 32 bytes (64 caracteres hex)');
  }

  return key;
};

// Formato almacenado: iv:authTag:ciphertext (todo en hex)
const encrypt = (texto) => {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);

  const ciphertext = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
};

const decrypt = (valorCifrado) => {
  const [ivHex, authTagHex, ciphertextHex] = valorCifrado.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
};

module.exports = { encrypt, decrypt };
