const env = require('../utils/env');
const Response = require('../utils/response');

module.exports = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey || apiKey !== env.API_KEY) {
    const response = Response.error('API key inválida o faltante', 401);
    return res.status(response.code).json(response);
  }

  next();
};
