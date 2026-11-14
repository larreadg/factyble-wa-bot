const { formatearGuaranies } = require('./moneda');
const { PLAZO_CREDITO } = require('./constants');

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

// `advertencias` es opcional y solo lo pasa el flujo de fotos: ahí son los avisos de lectura
// dudosa (montos que no cierran, dígitos ilegibles) y el usuario tiene que verlos justo antes
// de confirmar. El flujo de texto no las muestra en el resumen (ver botOrchestrator).
const construirResumenConfirmacion = (borrador, { advertencias = [] } = {}) => {
  const lineasItems = borrador.items.map(construirLineaItem).join('\n');
  // A crédito se muestra el plazo que va a salir en la factura: el que dijo el usuario o, si no
  // dijo ninguno, el default con el que emite el backend.
  const condicionVentaTexto = borrador.condicionVenta === 'CREDITO'
    ? `Crédito (${borrador.plazoCredito || PLAZO_CREDITO.POR_DEFECTO})`
    : 'Contado';
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
    ...(advertencias.length ? ['*Revisá esto antes de confirmar:*', ...advertencias.map((advertencia) => `⚠️ _${advertencia}_`), ''] : []),
    '¿Está todo correcto? 😊',
    '✅ Escribí *"sí"* para emitir',
    '✏️ O decime qué querés corregir',
    '❌ O escribí *"cancelar"* para descartar',
  ].join('\n');
};

module.exports = { construirMensajeCamposFaltantes, construirResumenConfirmacion };
