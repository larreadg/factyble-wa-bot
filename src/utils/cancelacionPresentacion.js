const { abreviarCdc } = require('./notaCreditoPresentacion');

const etiquetaTipoDocumento = (tipoDocumento) => (tipoDocumento === 'FACTURA' ? 'factura' : 'nota de crédito');

const construirResumenConfirmacionCancelacion = (borrador) =>
  [
    '⚠️ *Confirmación de cancelación*',
    '━━━━━━━━━━━━━━━',
    `Vas a cancelar esta *${etiquetaTipoDocumento(borrador.tipoDocumento)}*:`,
    '',
    `🔗 CDC: ${abreviarCdc(borrador.cdc)}`,
    '',
    '‼️ *Atención: esta acción es irreversible.*',
    'El documento quedará *anulado y sin validez fiscal* ante la SET.',
    '',
    '¿Confirmás la cancelación?',
    '✅ Escribí *"sí"* para cancelar el documento',
    '❌ O escribí *"no"* para dejarlo como está',
  ].join('\n');

// El 404 puede significar que el CDC no existe en la empresa, o que el usuario eligió
// mal el tipo de documento (ej. marcó "factura" pero el CDC es de una nota de
// crédito). Se le ofrece reintentar con el otro tipo, pero SIEMPRE pidiendo una nueva
// confirmación explícita antes de llamar al otro endpoint (nunca se reintenta solo).
const construirMensajeSugerirTipoAlternativo = (borrador) => {
  const tipoIntentado = etiquetaTipoDocumento(borrador.tipoDocumento);
  const tipoAlternativo = borrador.tipoDocumento === 'FACTURA' ? 'nota de crédito' : 'factura';
  return [
    `🤔 *No encontré ninguna ${tipoIntentado} con ese código en tu empresa.*`,
    '',
    `¿Puede ser que en realidad sea una *${tipoAlternativo}*?`,
    '',
    `Respondeme *"sí"* para buscarla como ${tipoAlternativo},`,
    'o enviame otro CDC si el código estaba mal.',
  ].join('\n');
};

const construirMensajeCancelacionExitosa = ({ cdc, estadoSifen }) =>
  [
    '✅ *Documento cancelado correctamente*',
    '━━━━━━━━━━━━━━━',
    `🔗 CDC: ${abreviarCdc(cdc)}`,
    `📄 Estado en SIFEN: *${estadoSifen}*`,
    '',
    'El documento quedó *anulado y sin validez fiscal*.',
    '¿Te ayudo con algo más? 😊',
  ].join('\n');

// Caso B del paso 5: HTTP 200 pero SIFEN rechazó el evento de cancelación (el
// documento conserva su estado previo). Un motivo típico es que venció el plazo que
// SIFEN permite para cancelar: en ese caso se sugiere la nota de crédito como
// alternativa para revertir el efecto de la factura.
const construirMensajeRechazoSifen = ({ estadoSifen, mensajeRespuesta, codigoRespuesta }) => {
  const base = [
    '⚠️ *La SET (SIFEN) rechazó la cancelación.*',
    '',
    `📄 El documento sigue en estado: *${estadoSifen ?? 'desconocido'}*`,
    `📋 Motivo: _${mensajeRespuesta ?? 'no informado'}_${codigoRespuesta ? ` (código ${codigoRespuesta})` : ''}`,
  ].join('\n');

  if (!/plazo|vencid/i.test(mensajeRespuesta || '')) return base;

  return `${base}\n\n💡 Como ya pasó el plazo para cancelar, la alternativa es emitir una\n*nota de crédito* por el total. Escribime *"nota de crédito"* y te guío.`;
};

const construirMensajeNotaCreditoVinculadas = (mensajeApi) => {
  const match = (mensajeApi || '').match(/(\d+)/);
  const detalle = match ? `${match[1]} nota(s) de crédito aprobada(s)` : 'notas de crédito aprobadas';
  return [
    '❌ *No se puede cancelar esta factura.*',
    '',
    `Tiene *${detalle}* vinculada(s), y la SET no permite`,
    'cancelar una factura en esa situación.',
    '',
    '💡 Si necesitás dejarla sin efecto, la alternativa es emitir una',
    '*nota de crédito por el saldo restante*. Escribime *"nota de crédito"* y te guío.',
  ].join('\n');
};

const construirMensajeEstadoNoAprobado = (mensajeApi) => {
  const match = (mensajeApi || '').match(/estado actual:?\s*([A-Za-zÁÉÍÓÚÑ_]+)/i);
  const lineaEstado = match ? `\n\n📄 Estado actual: *${match[1]}*` : '';
  return `⚠️ *Ese documento no se puede cancelar todavía.*${lineaEstado}\nSolo se pueden cancelar documentos *aprobados* por la SET.\n\n⏳ Si lo emitiste hace poco, esperá unos minutos y volvé a intentar.`;
};

module.exports = {
  construirResumenConfirmacionCancelacion,
  construirMensajeSugerirTipoAlternativo,
  construirMensajeCancelacionExitosa,
  construirMensajeRechazoSifen,
  construirMensajeNotaCreditoVinculadas,
  construirMensajeEstadoNoAprobado,
};
