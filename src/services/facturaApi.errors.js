// Tipos posibles: AUTH_FAILED, VALIDATION, NOT_FOUND, SERVER_ERROR, NETWORK, TIMEOUT,
// DOWNLOAD_FAILED, UNKNOWN.
class FacturaApiError extends Error {
  constructor(type, message, cause) {
    super(message);
    this.name = 'FacturaApiError';
    this.type = type;
    this.cause = cause;
  }
}

module.exports = { FacturaApiError };
