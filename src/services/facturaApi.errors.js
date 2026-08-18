// Tipos posibles: AUTH_FAILED, VALIDATION, NOT_FOUND, SERVER_ERROR, NETWORK, TIMEOUT,
// DOWNLOAD_FAILED, UNKNOWN.
// `status` es el código HTTP crudo cuando aplica (ej. 502/503/504 en un SERVER_ERROR):
// lo usa facturaEmision.service.js para decidir si un error amerita reintento transitorio.
class FacturaApiError extends Error {
  constructor(type, message, cause, status = null) {
    super(message);
    this.name = 'FacturaApiError';
    this.type = type;
    this.cause = cause;
    this.status = status;
  }
}

// ¿El error es una falla TRANSITORIA del servicio (que amerita reintento/reconciliación),
// en contraste con un rechazo de negocio (VALIDATION/NOT_FOUND) que hay que corregir? Cubre
// timeout, red caída y cualquier 5xx del servidor. Compartido por la emisión de factura y de
// nota de crédito para clasificar igual en ambos flujos.
const esErrorTransitorio = (error) =>
  error instanceof FacturaApiError && ['TIMEOUT', 'NETWORK', 'SERVER_ERROR'].includes(error.type);

module.exports = { FacturaApiError, esErrorTransitorio };
