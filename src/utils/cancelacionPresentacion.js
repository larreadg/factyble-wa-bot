const { abreviarCdc } = require('./notaCreditoPresentacion');

const etiquetaTipoDocumento = (tipoDocumento) => (tipoDocumento === 'FACTURA' ? 'factura' : 'nota de crédito');

const construirResumenConfirmacionCancelacion = (borrador) =>
  [
    '⚠️ *Confirmación de cancelación*',
    '',
    `Vas a cancelar la siguiente ${etiquetaTipoDocumento(borrador.tipoDocumento)}:`,
    `CDC: ${abreviarCdc(borrador.cdc)}`,
    '',
    'Esta acción es *irreversible*: el documento quedará',
    'anulado ante SIFEN y perderá validez fiscal.',
    '',
    '¿Confirmás la cancelación? (sí / no)',
  ].join('\n');

// El 404 puede significar que el CDC no existe en la empresa, o que el usuario eligió
// mal el tipo de documento (ej. marcó "factura" pero el CDC es de una nota de
// crédito). Se le ofrece reintentar con el otro tipo, pero SIEMPRE pidiendo una nueva
// confirmación explícita antes de llamar al otro endpoint (nunca se reintenta solo).
const construirMensajeSugerirTipoAlternativo = (borrador) => {
  const tipoIntentado = etiquetaTipoDocumento(borrador.tipoDocumento);
  const tipoAlternativo = borrador.tipoDocumento === 'FACTURA' ? 'nota de crédito' : 'factura';
  return `No encontré ninguna ${tipoIntentado} con ese CDC en tu empresa. ¿Puede ser que sea una ${tipoAlternativo}? Si querés, pruebo cancelarla como ${tipoAlternativo}. (sí / no)`;
};

const construirMensajeCancelacionExitosa = ({ cdc, estadoSifen }) =>
  ['✅ *Documento cancelado*', `CDC: ${abreviarCdc(cdc)}`, `Estado SIFEN: ${estadoSifen}`, 'El documento quedó anulado y sin validez fiscal.'].join(
    '\n',
  );

// Caso B del paso 5: HTTP 200 pero SIFEN rechazó el evento de cancelación (el
// documento conserva su estado previo). Un motivo típico es que venció el plazo que
// SIFEN permite para cancelar: en ese caso se sugiere la nota de crédito como
// alternativa para revertir el efecto de la factura.
const construirMensajeRechazoSifen = ({ estadoSifen, mensajeRespuesta, codigoRespuesta }) => {
  const base = [
    `⚠️ SIFEN rechazó la cancelación. El documento sigue en estado ${estadoSifen ?? 'desconocido'}.`,
    `Motivo: ${mensajeRespuesta ?? 'no informado'}${codigoRespuesta ? ` (código ${codigoRespuesta})` : ''}.`,
  ].join('\n');

  if (!/plazo|vencid/i.test(mensajeRespuesta || '')) return base;

  return `${base}\n\nParece que venció el plazo que SIFEN permite para cancelar este documento. Si querés revertir su efecto, puedo ayudarte a emitir una nota de crédito en su lugar.`;
};

const construirMensajeNotaCreditoVinculadas = (mensajeApi) => {
  const match = (mensajeApi || '').match(/(\d+)/);
  const detalle = match ? `${match[1]} nota(s) de crédito aprobada(s)` : 'notas de crédito aprobadas';
  return `No se puede cancelar esta factura porque tiene ${detalle} vinculada(s). Primero habría que cancelar esas notas de crédito. ¿Querés que te ayude con eso?`;
};

const construirMensajeEstadoNoAprobado = (mensajeApi) => {
  const match = (mensajeApi || '').match(/estado actual:?\s*([A-Za-zÁÉÍÓÚÑ_]+)/i);
  const sufijo = match ? ` (estado actual: ${match[1]})` : '';
  return `El documento no se puede cancelar porque no está aprobado${sufijo}. Solo se pueden cancelar documentos en estado APROBADO. Si el estado es pendiente o en proceso, esperá unos minutos y volvé a intentar.`;
};

module.exports = {
  construirResumenConfirmacionCancelacion,
  construirMensajeSugerirTipoAlternativo,
  construirMensajeCancelacionExitosa,
  construirMensajeRechazoSifen,
  construirMensajeNotaCreditoVinculadas,
  construirMensajeEstadoNoAprobado,
};
