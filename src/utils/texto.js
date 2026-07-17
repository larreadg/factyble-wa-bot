const quitarAcentos = (texto) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '');

// Cada patrón matchea una "palabra de saludo", tolerando repeticiones/alargamientos
// coloquiales (ej. "holaaa", "heey") en vez de exigir una coincidencia exacta de lista.
const PATRONES_PALABRA_SALUDO = [
  /^h+o+l+a+s?$/, // hola, holaa, holaaa, holas
  /^o+l+a+s?$/, // ola, olaa (sin "h")
  /^h+e+y+$/, // hey, heey
  /^h+o+l+i+s*$/, // holis, holiss
  /^buen[oa]?s?$/, // buen, buena, buenos, buenas
  /^dias?$/, // dia, dias (ya sin acentos)
  /^tardes?$/, // tarde, tardes
  /^noches?$/, // noche, noches
  /^que$/, // "que tal"
  /^tal$/,
  /^saludos?$/,
];

const esPalabraDeSaludo = (palabra) => PATRONES_PALABRA_SALUDO.some((patron) => patron.test(palabra));

// Saludo puro: el mensaje completo está compuesto únicamente por palabras de saludo
// (permitiendo repeticiones, alargamientos y puntuación variada), sin ningún otro
// contenido. Se resuelve localmente (sin llamar a la IA) por costo/latencia: si el
// mensaje trae cualquier otra palabra (por ejemplo un pedido de factura), esto
// devuelve false y la clasificación queda en manos del parser.
const esSaludoPuro = (texto) => {
  const normalizado = quitarAcentos(String(texto || '').toLowerCase())
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalizado) return false;

  const palabras = normalizado.split(' ').filter(Boolean);
  return palabras.length > 0 && palabras.every(esPalabraDeSaludo);
};

const normalizarTexto = (raw) => {
  if (!raw || typeof raw !== 'string') return null;
  const limpio = raw.trim().replace(/\s+/g, ' ');
  return limpio.length > 0 ? limpio : null;
};

const normalizarTelefono = (raw) => String(raw || '').replace(/\D/g, '');

module.exports = {
  esSaludoPuro,
  normalizarTexto,
  normalizarTelefono,
};
