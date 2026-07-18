const { formatearGuaranies } = require('./moneda');

// Muestra solo el principio y el final del CDC (44 dígitos) en los mensajes al usuario,
// para no saturar el chat con el código completo cada vez que se resume el estado.
const abreviarCdc = (cdc) => (cdc && cdc.length > 8 ? `${cdc.slice(0, 4)}...${cdc.slice(-4)}` : cdc);

const construirMensajeTotalEncontrado = ({ total, totalIva }) =>
  `✅ Encontré la factura. Total: ${formatearGuaranies(total)} (IVA ${formatearGuaranies(totalIva)}). ¿Qué ítems querés acreditar?`;

const construirMensajeMontoExcedeTotal = (totalAcreditar, totalFactura) =>
  `⚠️ El total de la nota de crédito (${formatearGuaranies(totalAcreditar)}) supera el total de la factura (${formatearGuaranies(totalFactura)}). El monto acreditado no puede ser mayor al facturado. ¿Querés ajustar las cantidades o precios?`;

const construirResumenConfirmacionNC = (borrador) => {
  const lineasItems = borrador.items
    .map((item, indice) => {
      return [
        `*${indice + 1}. ${item.descripcion}*`,
        '',
        `🔢 Cantidad: *${item.cantidad}*`,
        `💰 Precio unitario: *${formatearGuaranies(item.precioUnitario)}*`,
        `📊 IVA: *${item.tasa}*`,
        `🧮 Subtotal: *${formatearGuaranies(item.subtotal)}*`,
      ].join('\n');
    })
    .join('\n\n');

  const separador = '━━━━━━━━━━━━━━';

  return [
    '📋 *Resumen de Nota de Crédito*',
    '',
    '🧾 *Factura original*',
    `CDC: ${abreviarCdc(borrador.cdc)}`,
    `Total facturado: ${formatearGuaranies(borrador.totalFactura)}`,
    '',
    separador,
    '',
    '📦 *Ítems a acreditar*',
    '',
    lineasItems,
    '',
    separador,
    '',
    `💵 *Total NC: ${formatearGuaranies(borrador.totales.totalAcreditar)}*`,
    '',
    '¿Confirmás la emisión? 😊',
    '',
    '✅ Respondé *SÍ* para emitir la nota de crédito.',
    '✏️ Escribí la corrección que necesitás realizar.',
    '❌ Respondé *CANCELAR* para detener la emisión.',
  ].join('\n');
};

module.exports = { abreviarCdc, construirMensajeTotalEncontrado, construirMensajeMontoExcedeTotal, construirResumenConfirmacionNC };
