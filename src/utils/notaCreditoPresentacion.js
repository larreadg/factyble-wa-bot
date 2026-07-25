const { formatearGuaranies } = require('./moneda');

// Muestra solo el principio y el final del CDC (44 dígitos) en los mensajes al usuario,
// para no saturar el chat con el código completo cada vez que se resume el estado.
const abreviarCdc = (cdc) => (cdc && cdc.length > 8 ? `${cdc.slice(0, 4)}...${cdc.slice(-4)}` : cdc);

const construirMensajeTotalEncontrado = ({ total, totalIva }) => `✅ *¡Encontré la factura!*

💰 Total facturado: *${formatearGuaranies(total)}*
🧾 IVA incluido: ${formatearGuaranies(totalIva)}

Ahora contame *qué querés acreditar*:
📦 Producto o servicio
🔢 Cantidad
💰 Precio unitario

Puede ser una parte o el total de la factura.`;

const construirMensajeMontoExcedeTotal = (totalAcreditar, totalFactura) => `⚠️ *El monto a acreditar es mayor que el saldo de la factura.*

💰 Querés acreditar: *${formatearGuaranies(totalAcreditar)}*
📄 Saldo disponible de la factura: *${formatearGuaranies(totalFactura)}*

Ajustá las cantidades o precios de la nota de crédito para que no supere
ese saldo, y volvemos a intentar ✏️`;

const construirLineaItemNC = (item) =>
  [`📦 ${item.descripcion}`, `    ${item.cantidad} × ${formatearGuaranies(item.precioUnitario)} — Subtotal: ${formatearGuaranies(item.subtotal)}`].join(
    '\n',
  );

const construirResumenConfirmacionNC = (borrador) => {
  const lineasItems = borrador.items.map(construirLineaItemNC).join('\n');
  const separador = '━━━━━━━━━━━━━━━';

  return [
    '📋 *Resumen de tu nota de crédito*',
    separador,
    `🔗 Sobre la factura CDC: ${abreviarCdc(borrador.cdc)}`,
    `💰 Total facturado: ${formatearGuaranies(borrador.totalFactura)}`,
    '',
    '🛒 *Vas a acreditar:*',
    lineasItems,
    '',
    separador,
    `💰 *TOTAL A ACREDITAR: ${formatearGuaranies(borrador.totales.totalAcreditar)}*`,
    '',
    '¿Confirmás la emisión? 😊',
    '✅ Escribí *"sí"* para emitir',
    '✏️ O decime qué querés corregir',
    '❌ O escribí *"cancelar"* para descartar',
  ].join('\n');
};

module.exports = { abreviarCdc, construirMensajeTotalEncontrado, construirMensajeMontoExcedeTotal, construirResumenConfirmacionNC };
