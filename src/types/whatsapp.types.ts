/** Flattens intersection types in editor tooltips/errors without changing behavior. */
export type Prettify<T> = { [K in keyof T]: T[K] } & {};

export interface WhatsAppContact {
  profile: { name: string };
  wa_id: string;
}

export interface WhatsAppMetadata {
  display_phone_number: string;
  phone_number_id: string;
}

interface BaseIncomingMessage {
  id: string;
  from: string;
  timestamp: string;
  context?: { from: string; id: string };
}

export type WhatsAppIncomingMessage = Prettify<
  BaseIncomingMessage &
    (
      | { type: "text"; text: { body: string } }
      | {
          type: "image";
          image: { id: string; mime_type: string; sha256: string; caption?: string };
        }
      | { type: "audio"; audio: { id: string; mime_type: string } }
      | {
          type: "video";
          video: { id: string; mime_type: string; sha256: string; caption?: string };
        }
      | {
          type: "document";
          document: { id: string; mime_type: string; sha256: string; filename?: string };
        }
      | { type: "sticker"; sticker: { id: string; mime_type: string; animated: boolean } }
      | {
          type: "location";
          location: { latitude: number; longitude: number; name?: string; address?: string };
        }
      | {
          type: "button";
          button: { text: string; payload: string };
        }
      | {
          type: "interactive";
          interactive:
            | { type: "button_reply"; button_reply: { id: string; title: string } }
            | {
                type: "list_reply";
                list_reply: { id: string; title: string; description?: string };
              };
        }
      | { type: "reaction"; reaction: { message_id: string; emoji: string } }
      | { type: "unknown"; errors?: Array<{ code: number; title: string }> }
    )
>;

export type WhatsAppMessageStatus = Prettify<
  {
    id: string;
    recipient_id: string;
    timestamp: string;
  } & (
    | { status: "sent" }
    | { status: "delivered" }
    | { status: "read" }
    | {
        status: "failed";
        errors: Array<{ code: number; title: string; message?: string }>;
      }
  )
>;

export interface WhatsAppChangeValue {
  messaging_product: "whatsapp";
  metadata: WhatsAppMetadata;
  contacts?: WhatsAppContact[];
  messages?: WhatsAppIncomingMessage[];
  statuses?: WhatsAppMessageStatus[];
}

export interface WhatsAppWebhookChange {
  value: WhatsAppChangeValue;
  field: "messages";
}

export interface WhatsAppWebhookEntry {
  id: string;
  changes: WhatsAppWebhookChange[];
}

export interface WhatsAppWebhookPayload {
  object: "whatsapp_business_account";
  entry: WhatsAppWebhookEntry[];
}

/** Narrows an incoming message to a specific `type` — usable as an Array#filter predicate. */
export function isMessageOfType<T extends WhatsAppIncomingMessage["type"]>(type: T) {
  return (
    message: WhatsAppIncomingMessage,
  ): message is Extract<WhatsAppIncomingMessage, { type: T }> => message.type === type;
}

export type WhatsAppOutgoingMessage =
  | { type: "text"; text: { body: string; preview_url?: boolean } }
  | { type: "image"; image: { link: string; caption?: string } | { id: string; caption?: string } }
  | {
      type: "template";
      template: {
        name: string;
        language: { code: string };
        components?: Array<{ type: string; parameters: Array<{ type: string; text?: string }> }>;
      };
    };

export type SendMessageRequest = Prettify<
  {
    messaging_product: "whatsapp";
    recipient_type: "individual";
    to: string;
  } & WhatsAppOutgoingMessage
>;
