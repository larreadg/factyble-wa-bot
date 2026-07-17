// Tipos posibles: TIMEOUT, RATE_LIMIT, CONNECTION, AUTH, EMPTY_RESPONSE, REFUSAL,
// INCOMPLETE, INVALID_OUTPUT, INVALID_INPUT, UNKNOWN.
class OpenAIServiceError extends Error {
  constructor(type, message, cause) {
    super(message);
    this.name = 'OpenAIServiceError';
    this.type = type;
    this.cause = cause;
  }
}

module.exports = { OpenAIServiceError };
