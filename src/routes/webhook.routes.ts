import { Router } from "express";
import { webhookController } from "../controllers/webhook.controller.js";
import { verifyWebhookSignature } from "../middleware/verify-webhook-signature.middleware.js";

export const webhookRouter = Router();

webhookRouter.get("/", webhookController.verify);
webhookRouter.post("/", verifyWebhookSignature, webhookController.receive);
