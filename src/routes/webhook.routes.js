const { Router } = require('express');
const webhookController = require('../controllers/webhook.controller');

const router = Router();

router.get('/webhook', webhookController.verify);
router.post('/webhook', webhookController.receive);

module.exports = router;
