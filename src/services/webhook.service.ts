import crypto from "node:crypto";
import type { WebhookEvent } from "@prisma/client";
import type { Db } from "../infrastructure/db.js";
import { DuplicateWebhookError } from "../domain/errors.js";
import { isUniqueConstraintError } from "../utils/prisma-errors.js";

export function hashWebhookPayload(rawBody: Buffer): string {
  return crypto.createHash("sha256").update(rawBody).digest("hex");
}

export interface RegisterWebhookEventInput {
  tenantId?: string;
  eventType: string;
  rawBody: Buffer;
  now: Date;
}

/**
 * Persists the webhook delivery before anything else touches it (see
 * pipeline step order in docs/conversation-architecture.md). Meta's webhook
 * envelope has no single stable event id — `payloadHash` (a hash of the
 * exact raw bytes) is what makes a retried delivery of the *same* HTTP
 * request idempotent. Per-message idempotency is a second, independent
 * layer handled by `Message.providerMessageId` (see message.service.ts) —
 * that one also catches the case where Meta splits/re-batches the same
 * message across differently-shaped payloads.
 */
export async function registerWebhookEventIdempotently(
  db: Db,
  input: RegisterWebhookEventInput,
): Promise<WebhookEvent> {
  const payloadHash = hashWebhookPayload(input.rawBody);

  try {
    return await db.webhookEvent.create({
      data: {
        eventType: input.eventType,
        payload: input.rawBody.toString("utf8"),
        payloadHash,
        status: "RECEIVED",
        receivedAt: input.now,
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new DuplicateWebhookError(payloadHash);
    }
    throw err;
  }
}

export async function markWebhookProcessing(db: Db, id: string, now: Date): Promise<void> {
  await db.webhookEvent.update({
    where: { id },
    data: { status: "PROCESSING", processingStartedAt: now, attemptCount: { increment: 1 } },
  });
}

export async function markWebhookProcessed(db: Db, id: string, now: Date): Promise<void> {
  await db.webhookEvent.update({
    where: { id },
    data: { status: "PROCESSED", processedAt: now },
  });
}

export async function markWebhookFailed(
  db: Db,
  id: string,
  error: string,
  nextAttemptAt?: Date,
): Promise<void> {
  await db.webhookEvent.update({
    where: { id },
    data: {
      status: nextAttemptAt ? "RETRY_PENDING" : "FAILED",
      lastError: error,
      ...(nextAttemptAt ? { nextAttemptAt } : {}),
    },
  });
}

export async function markWebhookIgnored(
  db: Db,
  id: string,
  reason: string,
  now: Date,
): Promise<void> {
  await db.webhookEvent.update({
    where: { id },
    data: { status: "IGNORED", lastError: reason, processedAt: now },
  });
}
