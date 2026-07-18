const { Router } = require('express');
const healthRoutes = require('./health.routes');
const webhookRoutes = require('./webhook.routes');
const empresaRoutes = require('./empresa.routes');
const contactoRoutes = require('./contacto.routes');
const documentoRoutes = require('./documento.routes');

const router = Router();

router.use(healthRoutes);
router.use(webhookRoutes);
router.use(empresaRoutes);
router.use(contactoRoutes);
router.use(documentoRoutes);

module.exports = router;
