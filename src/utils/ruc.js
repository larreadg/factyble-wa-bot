// Validación del RUC paraguayo que informa el usuario: formato (NNN...-D) y, desde que un RUC mal
// tipeado llegó hasta la emisión, también el dígito verificador por Módulo 11.
// Spec SIFEN: el número base del RUC tiene entre 3 y 8 dígitos; el DV es 1 dígito.
const RUC_REGEX = /^\d{3,8}-\d$/;

/**
 * Dígito verificador de un RUC paraguayo (Módulo 11, algoritmo de la SET). Es el mismo cálculo que
 * factyble-back hace en `src/utils/sifen/cdc.js`; se replica acá —y no se comparte por paquete,
 * porque los repos no lo hacen— para poder detectar el error DURANTE la conversación de WhatsApp,
 * que es el único momento en que el usuario tiene al cliente enfrente para verificar el número.
 *
 * Por qué importa: un RUC con el DV cambiado no es solo un dato feo, es un número que puede
 * pertenecer a otra persona. El caso que motivó esto fue "5808589-2" por "5878589-2" (un 7 tipeado
 * como 0): el backend no lo encuentra en el padrón, SIFEN responde que no existe, y su camino de
 * degradación resolvería la cédula 5808589 — que existe y es de un tercero. El Módulo 11 detecta
 * exactamente esta clase de error (dígitos cambiados y transposiciones), y acá cuesta una función.
 *
 * @param {string} base - Parte numérica del RUC, sin DV
 * @returns {number} DV esperado (0-9)
 */
const calcularDigitoVerificador = (base) => {
  let peso = 2;
  let suma = 0;

  for (let i = base.length - 1; i >= 0; i--) {
    suma += Number(base[i]) * peso;
    peso = peso === 11 ? 2 : peso + 1;
  }

  const resto = suma % 11;
  return resto > 1 ? 11 - resto : 0;
};

/**
 * Normaliza y valida el RUC informado.
 *
 * `motivo` acompaña a `invalido` para que el bot pueda decirle al usuario QUÉ está mal: "el formato
 * no es válido" y "el dígito verificador no corresponde" son problemas distintos y se corrigen de
 * forma distinta (el segundo casi siempre significa que hay un dígito mal en el número, no en el DV).
 *
 * @param {string} raw
 * @returns {{valor: string|null, invalido: boolean, motivo: 'formato'|'dv'|null}}
 */
const normalizarRuc = (raw) => {
  if (!raw || typeof raw !== 'string') return { valor: null, invalido: false, motivo: null };

  const limpio = raw.trim().replace(/\s+/g, '');
  if (!limpio) return { valor: null, invalido: false, motivo: null };

  if (!RUC_REGEX.test(limpio)) return { valor: null, invalido: true, motivo: 'formato' };

  const [base, dv] = limpio.split('-');

  if (Number(dv) !== calcularDigitoVerificador(base)) {
    return { valor: null, invalido: true, motivo: 'dv' };
  }

  return { valor: limpio, invalido: false, motivo: null };
};

module.exports = { normalizarRuc, calcularDigitoVerificador };
