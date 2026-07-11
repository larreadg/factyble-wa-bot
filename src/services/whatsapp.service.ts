import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import type { SendMessageRequest, WhatsAppOutgoingMessage } from "../types/whatsapp.types.js";

interface GraphApiErrorBody {
  error?: { message?: string; type?: string; code?: number };
}

export class WhatsAppService {
  private readonly baseUrl = `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}`;

  async sendMessage(to: string, message: WhatsAppOutgoingMessage): Promise<{ messageId: string }> {
    const body: SendMessageRequest = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      ...message,
    };

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as GraphApiErrorBody;
      logger.error({ status: response.status, errorBody }, "WhatsApp Graph API request failed");
      throw new AppError(errorBody.error?.message ?? "Failed to send WhatsApp message", 502);
    }

    const data = (await response.json()) as { messages: Array<{ id: string }> };
    return { messageId: data.messages[0]?.id ?? "" };
  }

  async sendTextMessage(to: string, text: string): Promise<{ messageId: string }> {
    return this.sendMessage(to, { type: "text", text: { body: text } });
  }

  async markAsRead(messageId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      }),
    });

    if (!response.ok) {
      logger.warn({ status: response.status, messageId }, "Failed to mark WhatsApp message as read");
    }
  }
}

export const whatsappService = new WhatsAppService();
