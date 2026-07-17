const Response = require('../utils/response');

const check = (req, res) => {
  const response = Response.success({ status: 'ok', timestamp: new Date().toISOString() });
  res.status(response.code).json(response);
};

module.exports = { check };
