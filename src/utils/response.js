class Response {
  constructor(status, code, data, message) {
    this.status = status;
    this.code = code;
    this.data = data;
    this.message = message;
  }

  static success(data, message = 'Operación exitosa', code = 200, status = 'success') {
    return new Response(status, code, data, message);
  }

  static error(message = 'Ocurrió un error', code = 500, data = null, status = 'error') {
    return new Response(status, code, data, message);
  }
}

module.exports = Response;
