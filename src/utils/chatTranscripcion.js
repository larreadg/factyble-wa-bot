// Formatea el detalle de un chat como .txt estilo "export de WhatsApp"
// ([d/m, HH:mm] emisor: contenido), para enviarlo a Telegram (ver chatExport.service.js).

const TIMEZONE = 'America/Asuncion';
const NOMBRE_BOT = 'factyble';

const formatearHora = (fecha) => {
  const parts = new Intl.DateTimeFormat('es-PY', {
    timeZone: TIMEZONE,
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(fecha);

  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('day')}/${get('month')}, ${get('hour')}:${get('minute')}`;
};

// El contenido de audio/imagen/documento no vive en Mensaje.contenidoTexto (ver
// mensaje.service.js), así que se arma una representación legible a partir de
// MensajeArchivo para esos tipos.
const contenidoLegible = (mensaje) => {
  if (mensaje.tipo === 'AUDIO') {
    const transcripcion = mensaje.archivo?.transcripcion;
    return transcripcion ? `🎤 (audio transcripto) ${transcripcion}` : '🎤 (audio sin transcripción)';
  }
  // Para fotos de facturas (también las enviadas como documento, que se registran como IMAGEN),
  // `transcripcion` guarda el JSON de lo que leyó el extractor (facturaImagenParser.service.js):
  // se incluye para poder auditar qué se interpretó.
  if (mensaje.tipo === 'IMAGEN') {
    const transcripcion = mensaje.archivo?.transcripcion;
    return transcripcion ? `📷 (imagen) leído: ${transcripcion}` : '📷 (imagen)';
  }
  if (mensaje.tipo === 'DOCUMENTO') return `📄 (documento)${mensaje.archivo?.nombreArchivo ? ` ${mensaje.archivo.nombreArchivo}` : ''}`;
  return mensaje.contenidoTexto || '';
};

const construirLinea = (mensaje, nombreContacto) => {
  const emisor = mensaje.direccion === 'ENTRANTE' ? nombreContacto : NOMBRE_BOT;
  return `[${formatearHora(mensaje.fechaMensaje)}] ${emisor}: ${contenidoLegible(mensaje)}`;
};

const construirTranscripcion = ({ contacto, operacion, resultado, mensajes, advertencia }) => {
  const nombreContacto = contacto.nombre || contacto.numeroTelefono;

  const lineasEncabezado = [`${operacion}: ${resultado.replace(/_/g, ' ')}`, `Contacto: ${nombreContacto} (${contacto.numeroTelefono})`];
  if (advertencia) lineasEncabezado.push(advertencia);
  lineasEncabezado.push('');

  const encabezado = lineasEncabezado.join('\n');
  const cuerpo = mensajes.map((mensaje) => construirLinea(mensaje, nombreContacto)).join('\n');

  return `${encabezado}${cuerpo}\n`;
};

module.exports = { construirTranscripcion };
