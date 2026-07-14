import type { WhatsAppIncomingMessage } from "../types/whatsapp.types.js";
import { normalizeText } from "./text-normalize.js";

/**
 * Flow-facing view of an inbound message, decoupled from the raw WhatsApp
 * Cloud API shape. Flows should never import `types/whatsapp.types.ts`
 * directly — this is the only surface they see.
 */
export interface NormalizedInboundMessage {
  /** Raw user-facing text, trimmed. Populated for text, button, and interactive replies. */
  text: string | null;
  /** `normalizeText(text)` — lowercase, accent-stripped — for matching menu options/commands. */
  normalizedText: string | null;
  /** `interactive.button_reply.id` / `interactive.list_reply.id`, when present. */
  interactiveId: string | null;
  /** `null` for system-triggered flow resumption (e.g. after an external call completes) — there is no real inbound WhatsApp message in that case. */
  raw: WhatsAppIncomingMessage | null;
}

/** Synthetic "message" used when a flow is resumed by a system event (external call result, timeout) rather than a real user message. */
export function systemTriggeredMessage(): NormalizedInboundMessage {
  return { text: null, normalizedText: null, interactiveId: null, raw: null };
}

export function normalizeInboundMessage(
  message: WhatsAppIncomingMessage,
): NormalizedInboundMessage {
  let text: string | null = null;
  let interactiveId: string | null = null;

  switch (message.type) {
    case "text":
      text = message.text.body.trim();
      break;
    case "button":
      text = message.button.text.trim();
      interactiveId = message.button.payload;
      break;
    case "interactive":
      if (message.interactive.type === "button_reply") {
        text = message.interactive.button_reply.title.trim();
        interactiveId = message.interactive.button_reply.id;
      } else {
        text = message.interactive.list_reply.title.trim();
        interactiveId = message.interactive.list_reply.id;
      }
      break;
  }

  return {
    text,
    normalizedText: text !== null ? normalizeText(text) : null,
    interactiveId,
    raw: message,
  };
}
