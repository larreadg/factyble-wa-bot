const crypto = require('../utils/crypto');
const facturaApiService = require('./facturaApi.service');
const empresaService = require('./empresa.service');

// Margen de seguridad: reautenticar un poco antes del vencimiento real del JWT en vez
// de arriesgarse a que expire a mitad de una emisión.
const MARGEN_EXPIRACION_MS = 60 * 1000;

const tokenCacheadoVigente = (empresa) => {
  if (!empresa.token || !empresa.tokenExpiracion) return null;
  const expiraEn = new Date(empresa.tokenExpiracion).getTime();
  return expiraEn - Date.now() > MARGEN_EXPIRACION_MS ? empresa.token : null;
};

// Decodifica (sin verificar firma, no la tenemos) el claim `exp` del JWT devuelto por
// /usuario/authenticate para saber cuándo refrescarlo. Si no se puede decodificar, se
// trata como "sin vencimiento conocido": la próxima llamada volverá a autenticar.
const decodificarExpiracionJwt = (token) => {
  try {
    const payload = token.split('.')[1];
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof json.exp === 'number' ? new Date(json.exp * 1000) : null;
  } catch {
    return null;
  }
};

const autenticarYGuardar = async (empresa) => {
  const password = crypto.decrypt(empresa.password);
  const token = await facturaApiService.autenticar({ usuario: empresa.usuario, password });
  const tokenExpiracion = decodificarExpiracionJwt(token);

  await empresaService.guardarToken(empresa.id, { token, tokenExpiracion });

  // Mantiene en memoria el objeto `empresa` recibido consistente con lo recién
  // persistido, por si se reutiliza más abajo en la misma emisión.
  empresa.token = token;
  empresa.tokenExpiracion = tokenExpiracion;

  return token;
};

const obtenerToken = async (empresa) => tokenCacheadoVigente(empresa) || autenticarYGuardar(empresa);

module.exports = { obtenerToken, autenticarYGuardar };
