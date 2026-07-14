import type { Message, MessageStatus, MessageType } from "@prisma/client";
import type { Db } from "../infrastructure/db.js";
import { DuplicateMessageError } from "../domain/errors.js";
import { isUniqueConstraintError } from "../utils/prisma-errors.js";

export interface AppendInboundMessageInput {
  tenantId: string;
  conversationId: string;
  sessionId?: string;
  whatsAppAccountId: string;
  contactId: string;
  providerMessageId: string;
  type: MessageType;
  text?: string;
  payload?: unknown;
  correlationId?: string;
  receivedAt: Date;
}

/**
 * Inserts the inbound message row, relying on the
 * `@@unique([whatsAppAccountId, providerMessageId])` constraint as the
 * single source of truth for "have we seen this WhatsApp message before".
 * Throws `DuplicateMessageError` rather than silently returning the
 * existing row, so callers are forced to consciously decide how to treat a
 * replay (the pipeline treats it as "acknowledge, do not re-run the flow").
 */
export async function appendInboundMessageIdempotently(
  db: Db,
  input: AppendInboundMessageInput,
): Promise<Message> {
  try {
    return await db.message.create({
      data: {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        whatsAppAccountId: input.whatsAppAccountId,
        contactId: input.contactId,
        providerMessageId: input.providerMessageId,
        direction: "INBOUND",
        type: input.type,
        status: "RECEIVED",
        receivedAt: input.receivedAt,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.payload !== undefined ? { payload: JSON.stringify(input.payload) } : {}),
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new DuplicateMessageError(input.providerMessageId);
    }
    throw err;
  }
}

export async function markMessageStatus(
  db: Db,
  messageId: string,
  status: MessageStatus,
): Promise<void> {
  await db.message.update({ where: { id: messageId }, data: { status } });
}

export async function attachMessageToSession(
  db: Db,
  messageId: string,
  sessionId: string,
): Promise<void> {
  await db.message.update({ where: { id: messageId }, data: { sessionId } });
}

export interface QueueOutboundMessageInput {
  tenantId: string;
  conversationId: string;
  sessionId?: string;
  whatsAppAccountId: string;
  contactId: string;
  text: string;
  correlationId?: string;
  now: Date;
}

/** Creates the outbound Message row in QUEUED status. The actual send happens later, via the outbox dispatcher, outside any DB transaction. */
export async function queueOutboundMessage(
  db: Db,
  input: QueueOutboundMessageInput,
): Promise<Message> {
  return db.message.create({
    data: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      whatsAppAccountId: input.whatsAppAccountId,
      contactId: input.contactId,
      direction: "OUTBOUND",
      type: "TEXT",
      status: "QUEUED",
      text: input.text,
      queuedAt: input.now,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    },
  });
}

export async function markMessageSent(
  db: Db,
  messageId: string,
  providerMessageId: string,
  now: Date,
): Promise<void> {
  await db.message.update({
    where: { id: messageId },
    data: { status: "SENT", providerMessageId, sentAt: now },
  });
}

export async function markMessageFailed(
  db: Db,
  messageId: string,
  errorCode: string | undefined,
  errorMessage: string,
  now: Date,
): Promise<void> {
  await db.message.update({
    where: { id: messageId },
    data: { status: "FAILED", failedAt: now, errorMessage, ...(errorCode ? { errorCode } : {}) },
  });
}

const STATUS_RANK: Record<MessageStatus, number> = {
  RECEIVED: 0,
  PROCESSING: 0,
  PROCESSED: 0,
  IGNORED: 0,
  QUEUED: 1,
  SENDING: 2,
  SENT: 3,
  DELIVERED: 4,
  READ: 5,
  FAILED: 6,
};

/**
 * WhatsApp status callbacks can arrive out of order. A message already
 * marked READ must never be downgraded back to DELIVERED/SENT, and a late
 * "failed" callback must not override a delivery that already succeeded.
 */
export function shouldApplyStatusTransition(current: MessageStatus, next: MessageStatus): boolean {
  if (next === "FAILED") {
    return current !== "DELIVERED" && current !== "READ";
  }
  return STATUS_RANK[next] > STATUS_RANK[current];
}

export interface RecordMessageStatusInput {
  whatsAppAccountId: string;
  providerMessageId: string;
  providerStatus: "sent" | "delivered" | "read" | "failed";
  providerTimestamp: Date;
  errorCode?: string;
  errorTitle?: string;
  errorDetails?: string;
  payload?: unknown;
}

const PROVIDER_STATUS_TO_MESSAGE_STATUS: Record<
  RecordMessageStatusInput["providerStatus"],
  MessageStatus
> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

/**
 * Always appends to `MessageStatusEvent` (full history, regardless of
 * ordering), and conditionally advances `Message.status` (the current,
 * monotonic view) via `shouldApplyStatusTransition`.
 */
export async function recordMessageStatus(db: Db, input: RecordMessageStatusInput): Promise<void> {
  const message = await db.message.findUnique({
    where: {
      whatsAppAccountId_providerMessageId: {
        whatsAppAccountId: input.whatsAppAccountId,
        providerMessageId: input.providerMessageId,
      },
    },
  });

  if (!message) {
    // Status callback for a message we never sent (or haven't recorded the providerMessageId for yet) — nothing to update, but still worth knowing about.
    return;
  }

  await db.messageStatusEvent.create({
    data: {
      messageId: message.id,
      providerStatus: input.providerStatus,
      providerTimestamp: input.providerTimestamp,
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      ...(input.errorTitle ? { errorTitle: input.errorTitle } : {}),
      ...(input.errorDetails ? { errorDetails: input.errorDetails } : {}),
      ...(input.payload !== undefined ? { payload: JSON.stringify(input.payload) } : {}),
    },
  });

  const nextStatus = PROVIDER_STATUS_TO_MESSAGE_STATUS[input.providerStatus];
  if (!shouldApplyStatusTransition(message.status, nextStatus)) {
    return;
  }

  const timestamps =
    nextStatus === "SENT"
      ? { sentAt: input.providerTimestamp }
      : nextStatus === "DELIVERED"
        ? { deliveredAt: input.providerTimestamp }
        : nextStatus === "READ"
          ? { readAt: input.providerTimestamp }
          : { failedAt: input.providerTimestamp };

  await db.message.update({
    where: { id: message.id },
    data: {
      status: nextStatus,
      ...timestamps,
      ...(nextStatus === "FAILED" && (input.errorDetails ?? input.errorTitle)
        ? { errorMessage: input.errorDetails ?? input.errorTitle }
        : {}),
      ...(nextStatus === "FAILED" && input.errorCode ? { errorCode: input.errorCode } : {}),
    },
  });
}
