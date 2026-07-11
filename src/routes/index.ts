import { Router } from "express";
import { healthRouter } from "./health.routes.js";
import { webhookRouter } from "./webhook.routes.js";

export const router = Router();

router.use("/health", healthRouter);
router.use("/webhook", webhookRouter);
