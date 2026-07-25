const { formatearGuaranies } = require('./moneda');

const construirMensajeCamposFaltantes = (camposFaltantes, { intentoConfirmar = false, advertencias = [] } = {}) => {
  const lineas = camposFaltantes.map((campo) => `🔸 _${campo}_`).join('\n');
  const bloqueAdvertencias = advertencias.length ? `\n\n${advertencias.map((advertencia) => `⚠️ _${advertencia}_`).join('\n')}` : '';

  if (intentoConfirmar) {
    return `✋ *Un momento: todavía no puedo emitir la factura.*\n\nAntes necesito:\n${lineas}${bloqueAdvertencias}\n\nEn cuanto me los pases, confirmamos 👍`;
  }

  return `✍️ *¡Vamos bien! Solo me faltan estos datos:*\n\n${lineas}${bloqueAdvertencias}\n\nEnviámelos y te muestro el resumen para confirmar 👍`;
};

const construirLineaItem = (item) =>
  [
    `📦 ${item.descripcion}`,
    `    ${item.cantidad} × ${formatearGuaranies(item.precioUnitario)} — IVA ${item.tasa} — Subtotal: ${formatearGuaranies(item.subtotal)}`,
  ].join('\n');

const construirResumenConfirmacion = (borrador) => {
  const lineasItems = borrador.items.map(construirLineaItem).join('\n');
  const condicionVentaTexto = borrador.condicionVenta === 'CREDITO' ? 'Crédito' : 'Contado';
  const etiquetaDocumento = borrador.cliente.tipoDocumento === 'CI' ? 'Cédula' : 'RUC';
  const separador = '━━━━━━━━━━━━━━━';

  return [
    '📋 *Resumen de tu factura*',
    separador,
    `👤 Cliente: *${borrador.cliente.nombre}*`,
    `🪪 ${etiquetaDocumento}: *${borrador.cliente.numeroDocumento}*`,
    `💳 Condición: *${condicionVentaTexto}*`,
    '',
    '🛒 *Detalle:*',
    lineasItems,
    '',
    separador,
    `💰 *TOTAL: ${formatearGuaranies(borrador.totales.totalGeneral)}*`,
    '',
    '¿Está todo correcto? 😊',
    '✅ Escribí *"sí"* para emitir',
    '✏️ O decime qué querés corregir',
    '❌ O escribí *"cancelar"* para descartar',
  ].join('\n');
};

module.exports = { construirMensajeCamposFaltantes, construirResumenConfirmacion };
