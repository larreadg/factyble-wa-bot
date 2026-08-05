// Muchos motivos de rechazo de SIFEN son sobre los datos del receptor (ej. "RUC del
// receptor inexistente"), así que sin el nombre/documento del cliente el usuario no
// sabe a qué venta corresponde. Se agrega como línea aparte, omitida si no se cargó
// (documentos emitidos antes de que existiera este campo).
const construirLineaCliente = (documento) => {
  if (documento.clienteNombre && documento.clienteDocumento) return `Cliente: ${documento.clienteNombre} (${documento.clienteDocumento})`;
  if (documento.clienteNombre) return `Cliente: ${documento.clienteNombre}`;
  if (documento.clienteDocumento) return `Cliente: ${documento.clienteDocumento}`;
  return null;
};

const construirCaptionPdf = (documento) => {
  const esFactura = documento.tipo === 'FACTURA';
  const etiqueta = esFactura ? 'Factura' : 'Nota de crédito';
  const emoji = esFactura ? '🧾' : '📄';
  const lineaCliente = construirLineaCliente(documento);

  if (!documento.numeroDocumentoFormateado) {
    return lineaCliente ? `✅ *¡${etiqueta} emitida!* 🎉\n${lineaCliente}` : `✅ *¡${etiqueta} emitida!* 🎉`;
  }

  const lineas = [`✅ *¡${etiqueta} emitida!* 🎉`, `${emoji} ${etiqueta} nro. *${documento.numeroDocumentoFormateado}*`];
  if (lineaCliente) lineas.push(lineaCliente);
  lineas.push('', 'Ya podés reenviarla a tu cliente 📤');

  return lineas.join('\n');
};

module.exports = { construirCaptionPdf };
