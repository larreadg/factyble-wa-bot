const SOPORTE_WHATSAPP = 'wa.me/595976788698';

const etiquetaTipoDocumento = (tipo) => (tipo === 'FACTURA' ? 'factura' : 'nota de crédito');

const construirMensajeRechazado = (documento) => {
  const numero = documento.numeroDocumentoFormateado ? ` Nº ${documento.numeroDocumentoFormateado}` : '';
  return [
    `⚠️ Tu ${etiquetaTipoDocumento(documento.tipo)}${numero} fue rechazada por SIFEN.`,
    `Motivo: ${documento.sifenEstadoMensaje || 'no informado'}.`,
  ].join('\n');
};

const construirMensajeError = (documento) => {
  const numero = documento.numeroDocumentoFormateado ? ` Nº ${documento.numeroDocumentoFormateado}` : '';
  return `❌ Hubo un problema al procesar tu ${etiquetaTipoDocumento(documento.tipo)}${numero}. Por favor comunicate con soporte: ${SOPORTE_WHATSAPP}`;
};

module.exports = { construirMensajeRechazado, construirMensajeError };
