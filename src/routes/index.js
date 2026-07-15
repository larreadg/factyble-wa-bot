const { Router } = require('express');
const healthRoutes = require('./health.routes');

const router = Router();

router.use(healthRoutes);

module.exports = router;
