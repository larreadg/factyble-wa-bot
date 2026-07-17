const { Router } = require('express');
const contactoController = require('../controllers/contacto.controller');
const apiKeyMiddleware = require('../middlewares/apiKey.middleware');
const validate = require('../middlewares/validate.middleware');
const contactoValidator = require('../validators/contacto.validator');

const router = Router();

router.post('/contacto', apiKeyMiddleware, contactoValidator.create, validate, contactoController.create);

module.exports = router;
