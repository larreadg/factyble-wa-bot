const { formatearGuaranies } = require('./moneda');

const construirMensajeCamposFaltantes = (camposFaltantes, { intentoConfirmar = false, advertencias = [] } = {}) => {
  const lineas = camposFaltantes.map((campo) => `- ${campo}.`);
  const intro = intentoConfirmar ? 'Todavía no puedo emitir la factura: antes necesito' : 'Para preparar la factura todavía necesito';
  const bloqueAdvertencias = advertencias.length ? `\n\n${advertencias.map((advertencia) => `⚠️ ${advertencia}`).join('\n')}` : '';
  return `${intro}:\n\n${lineas.join('\n')}${bloqueAdvertencias}`;
};

const construirResumenConfirmacion = (borrador) => {
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

  const condicionVentaTexto = borrador.condicionVenta === 'CREDITO' ? 'Crédito' : 'Contado';
  const etiquetaDocumento = borrador.cliente.tipoDocumento === 'CI' ? 'Cédula' : 'RUC';
  const separador = '━━━━━━━━━━━━━━';

  return [
    '🧾 *¡Tu factura está casi lista!*',
    '',
    'Por favor, revisá los datos antes de emitirla:',
    '',
    '👤 *Cliente*',
    borrador.cliente.nombre,
    '',
    `🪪 *${etiquetaDocumento}*`,
    borrador.cliente.numeroDocumento,
    '',
    '💳 *Condición de venta*',
    condicionVentaTexto,
    '',
    separador,
    '',
    '📦 *Detalle de la factura*',
    '',
    lineasItems,
    '',
    separador,
    '',
    `💵 *Total general: ${formatearGuaranies(borrador.totales.totalGeneral)}*`,
    '',
    '¿Está todo correcto? 😊',
    '',
    '✅ Respondé *SÍ* para emitir la factura.',
    '✏️ Escribí la corrección que necesitás realizar.',
    '❌ Respondé *CANCELAR* para detener la emisión.',
  ].join('\n');
};

module.exports = { construirMensajeCamposFaltantes, construirResumenConfirmacion };
