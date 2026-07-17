// El proyecto no cuenta con un algoritmo de validación de dígito verificador de RUC
// paraguayo; para este MVP solo se normaliza y valida el formato (NNN...-D), sin
// inventar un algoritmo de checksum nuevo.
// Spec SIFEN: el número base del RUC tiene entre 3 y 8 dígitos; el DV es 1 dígito.
const RUC_REGEX = /^\d{3,8}-\d$/;

const normalizarRuc = (raw) => {
  if (!raw || typeof raw !== 'string') return { valor: null, invalido: false };

  const limpio = raw.trim().replace(/\s+/g, '');
  if (!limpio) return { valor: null, invalido: false };

  if (!RUC_REGEX.test(limpio)) return { valor: null, invalido: true };

  return { valor: limpio, invalido: false };
};

module.exports = { normalizarRuc };
