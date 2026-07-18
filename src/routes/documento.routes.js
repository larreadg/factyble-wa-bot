const { Router } = require('express');
const documentoController = require('../controllers/documento.controller');
const apiKeyMiddleware = require('../middlewares/apiKey.middleware');
const validate = require('../middlewares/validate.middleware');
const documentoValidator = require('../validators/documento.validator');

const router = Router();

router.post('/documento/bulk-update', apiKeyMiddleware, documentoValidator.bulkUpdate, validate, documentoController.bulkUpdate);

module.exports = router;
