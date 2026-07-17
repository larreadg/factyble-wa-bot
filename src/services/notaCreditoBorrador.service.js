const { normalizarTexto } = require('../utils/texto');
const { TASAS_IVA } = require('./facturaParser.service');

const TASA_POR_DEFECTO = '10%';

const borradorVacio = () => ({
  version: 0,
  cdc: null,
  cdcInvalido: false,
  totalFactura: null,
  totalIvaFactura: null,
  items: [],
  camposFaltantes: [],
  advertencias: [],
  totales: { totalAcreditar: 0 },
  resultadoEmision: null,
});

const capitalizarPrimeraLetra = (texto) => (texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto);

// Reconstruye el borrador completo a partir de: el cdc extraído de forma determinística
// del texto crudo (ver src/utils/cdc.js, nunca vía IA), y los ítems ya interpretados por
// notaCreditoParser.service.js. El backend es la única fuente de verdad para
// camposFaltantes y totales, igual que en facturaBorrador.service.js.
const construirBorrador = ({ cdcExtraido, cdcInvalidoExtraido, itemsIA, advertenciasIA = [] }, borradorAnteriorCrudo) => {
  const borradorAnterior = borradorAnteriorCrudo || borradorVacio();
  const version = (borradorAnterior.version || 0) + 1;

  let cdc = borradorAnterior.cdc;
  let totalFactura = borradorAnterior.totalFactura;
  let totalIvaFactura = borradorAnterior.totalIvaFactura;
  let cdcInvalido = false;

  if (cdcExtraido && cdcExtraido !== borradorAnterior.cdc) {
    // CDC nuevo (primera vez, o corrección sobre uno anterior): fuerza reconsulta del
    // total, el que ya teníamos correspondía a otra factura.
    cdc = cdcExtraido;
    totalFactura = null;
    totalIvaFactura = null;
  } else if (!cdcExtraido && cdcInvalidoExtraido && !borradorAnterior.cdc) {
    cdcInvalido = true;
  }

  const items = (itemsIA || []).map((item) => {
    const descripcion = capitalizarPrimeraLetra(normalizarTexto(item.descripcion) || item.descripcion);
    const cantidad = typeof item.cantidad === 'number' ? item.cantidad : null;
    const precioUnitario = typeof item.precioUnitario === 'number' ? item.precioUnitario : null;
    const tasa = TASAS_IVA.includes(item.tasa) ? item.tasa : TASA_POR_DEFECTO;
    const subtotal = cantidad != null && precioUnitario != null ? Math.round(cantidad * precioUnitario) : null;

    return { descripcion, cantidad, precioUnitario, tasa, subtotal };
  });

  const camposFaltantes = [];

  if (!cdc) {
    camposFaltantes.push(cdcInvalido ? 'CDC de la factura (el código indicado no tiene 44 dígitos)' : 'CDC de la factura original (44 dígitos)');
  }

  if (items.length === 0) {
    camposFaltantes.push('Al menos un ítem a acreditar');
  }

  for (const item of items) {
    const etiqueta = item.descripcion || 'ítem sin descripción';
    if (item.cantidad == null) camposFaltantes.push(`Cantidad de "${etiqueta}"`);
    if (item.precioUnitario == null) camposFaltantes.push(`Precio unitario de "${etiqueta}"`);
  }

  const totalAcreditar = items.reduce((acumulado, item) => acumulado + (item.subtotal ?? 0), 0);

  return {
    version,
    cdc,
    cdcInvalido,
    totalFactura,
    totalIvaFactura,
    items,
    camposFaltantes,
    advertencias: Array.isArray(advertenciasIA) ? advertenciasIA.slice(0, 20) : [],
    totales: { totalAcreditar },
    resultadoEmision: borradorAnterior.resultadoEmision ?? null,
  };
};

// Lo único que se envía a la IA: nunca cdc/camposFaltantes/totales/resultadoEmision (el
// cdc se maneja 100% determinísticamente, ver src/utils/cdc.js).
const sanitizarBorradorParaIA = (borradorCrudo) => {
  if (!borradorCrudo) return null;
  return {
    items: borradorCrudo.items.map(({ descripcion, cantidad, precioUnitario, tasa }) => ({ descripcion, cantidad, precioUnitario, tasa })),
  };
};

// Compara solo los ítems (el cdc no depende de la IA, así que no aporta a detectar una
// "corrección no entendida"). Se usa para avisar cuando un mensaje del usuario no
// produjo ningún cambio real en los ítems.
const sonEquivalentes = (borradorA, borradorB) => {
  const proyectar = (b) => b.items.map(({ subtotal, ...resto }) => resto);
  return JSON.stringify(proyectar(borradorA)) === JSON.stringify(proyectar(borradorB));
};

module.exports = { borradorVacio, construirBorrador, sanitizarBorradorParaIA, sonEquivalentes };
