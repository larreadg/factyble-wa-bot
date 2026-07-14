import type { Request, Response } from "express";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { UnauthorizedError } from "../utils/errors.js";
import { processWebhookPayload } from "../services/inbound-message-processor.service.js";
import type { WhatsAppWebhookPayload } from "../types/whatsapp.types.js";

export class WebhookController {
  /** Meta calls this once when the webhook URL is configured, to confirm ownership. */
  verify = (req: Request, res: Response): void => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === env.WHATSAPP_VERIFY_TOKEN) {
      res.status(200).send(challenge);
      return;
    }

    throw new UnauthorizedError("Webhook verification failed");
  };

  receive = (req: Request, res: Response): void => {
    // Acknowledge immediately: Meta retries aggressively on non-2xx or slow responses.
    res.sendStatus(200);

    // Errors here must never reach Express error middleware: the response is
    // already sent, so `next(err)` would blow up trying to set headers twice.
    const rawBody = req.rawBody;
    if (!rawBody) {
      // Shouldn't happen: `verifyWebhookSignature` (webhook.routes.ts) runs first and already rejects requests without a raw body.
      logger.error("Missing rawBody on an already-verified webhook request");
      return;
    }

    processWebhookPayload(rawBody, req.body as WhatsAppWebhookPayload).catch((err: unknown) => {
      logger.error({ err }, "Failed to process WhatsApp webhook payload");
    });
  };
}

export const webhookController = new WebhookController();
