const { Router } = require('express');
const empresaController = require('../controllers/empresa.controller');
const apiKeyMiddleware = require('../middlewares/apiKey.middleware');
const validate = require('../middlewares/validate.middleware');
const empresaValidator = require('../validators/empresa.validator');

const router = Router();

router.post('/empresa', apiKeyMiddleware, empresaValidator.create, validate, empresaController.create);

module.exports = router;
