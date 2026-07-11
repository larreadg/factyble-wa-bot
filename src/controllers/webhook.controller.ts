import type { Request, Response } from "express";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { UnauthorizedError } from "../utils/errors.js";
import { whatsappService } from "../services/whatsapp.service.js";
import { botService } from "../services/bot.service.js";
import type { WhatsAppIncomingMessage, WhatsAppWebhookPayload } from "../types/whatsapp.types.js";

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
    this.processPayload(req.body as WhatsAppWebhookPayload).catch((err: unknown) => {
      logger.error({ err }, "Failed to process WhatsApp webhook payload");
    });
  };

  private async processPayload(payload: WhatsAppWebhookPayload): Promise<void> {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const { messages = [], statuses = [] } = change.value;

        for (const message of messages) {
          await this.handleIncomingMessage(message);
        }

        for (const status of statuses) {
          logger.info({ status }, "WhatsApp message status update");
        }
      }
    }
  }

  private async handleIncomingMessage(message: WhatsAppIncomingMessage): Promise<void> {
    logger.info({ from: message.from, type: message.type }, "Incoming WhatsApp message");

    await botService.handleIncomingMessage(message);
    await whatsappService.markAsRead(message.id);
  }
}

export const webhookController = new WebhookController();
