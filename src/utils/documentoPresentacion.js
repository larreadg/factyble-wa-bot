const SOPORTE_WHATSAPP = 'wa.me/595976788698';

const etiquetaTipoDocumento = (tipo) => (tipo === 'FACTURA' ? 'factura' : 'nota de crédito');

// Muchos motivos de rechazo de SIFEN son sobre los datos del receptor (ej. "RUC del
// receptor inexistente"), así que sin el nombre/documento del cliente el usuario no
// sabe a qué venta corresponde ni qué dato corregir. Se agrega como línea aparte,
// omitida si no se cargó (documentos emitidos antes de que existiera este campo).
const construirLineaCliente = (documento) => {
  if (documento.clienteNombre && documento.clienteDocumento) return `Cliente: ${documento.clienteNombre} (${documento.clienteDocumento})`;
  if (documento.clienteNombre) return `Cliente: ${documento.clienteNombre}`;
  if (documento.clienteDocumento) return `Cliente: ${documento.clienteDocumento}`;
  return null;
};

const construirMensajeRechazado = (documento) => {
  const numero = documento.numeroDocumentoFormateado ? ` Nº ${documento.numeroDocumentoFormateado}` : '';
  const lineas = [
    `⚠️ Tu ${etiquetaTipoDocumento(documento.tipo)}${numero} fue rechazada por SIFEN.`,
    `Motivo: ${documento.sifenEstadoMensaje || 'no informado'}.`,
  ];
  const lineaCliente = construirLineaCliente(documento);
  if (lineaCliente) lineas.push(lineaCliente);
  return lineas.join('\n');
};

const construirMensajeError = (documento) => {
  const numero = documento.numeroDocumentoFormateado ? ` Nº ${documento.numeroDocumentoFormateado}` : '';
  const lineas = [`❌ Hubo un problema al procesar tu ${etiquetaTipoDocumento(documento.tipo)}${numero}. Por favor comunicate con soporte: ${SOPORTE_WHATSAPP}`];
  const lineaCliente = construirLineaCliente(documento);
  if (lineaCliente) lineas.push(lineaCliente);
  return lineas.join('\n');
};

const construirCaptionPdf = (documento) => {
  const etiqueta = documento.tipo === 'FACTURA' ? 'Factura' : 'Nota de crédito';
  if (!documento.numeroDocumentoFormateado) return etiqueta;
  return `${etiqueta} nro.: ${documento.numeroDocumentoFormateado}`;
};

module.exports = { construirMensajeRechazado, construirMensajeError, construirCaptionPdf };
