export const OUTBOX_EVENT_TYPES = {
  SEND_WHATSAPP_MESSAGE: "SEND_WHATSAPP_MESSAGE",
  EXTERNAL_SERVICE_CALL: "EXTERNAL_SERVICE_CALL",
} as const;

export interface SendWhatsAppMessagePayload {
  messageId: string;
}

export interface ExternalServiceCallPayload {
  externalServiceRequestId: string;
  sessionId: string;
}
