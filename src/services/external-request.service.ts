import type {
  ExternalOperation,
  ExternalRequestStatus,
  ExternalServiceRequest,
} from "@prisma/client";
import type { Db } from "../infrastructure/db.js";
import { sanitizeForAudit } from "../utils/sanitize.js";
import { isUniqueConstraintError } from "../utils/prisma-errors.js";

export interface EnqueueExternalServiceRequestInput {
  tenantId: string;
  conversationId?: string;
  sessionId?: string;
  operation: ExternalOperation;
  idempotencyKey: string;
  correlationId: string;
  requestPayload: Record<string, unknown>;
  now: Date;
}

/**
 * Creates the PENDING record for a billing-backend call, keyed by a unique
 * `(tenantId, idempotencyKey)`. If a row for this key already exists — a
 * retried confirmation, an outbox redelivery — the existing row is returned
 * instead of a fresh one, so the caller can inspect its current status
 * rather than firing a second HTTP call. Never store secrets in
 * `requestPayload`; it is sanitized before being persisted.
 */
export async function enqueueExternalServiceRequest(
  db: Db,
  input: EnqueueExternalServiceRequestInput,
): Promise<ExternalServiceRequest> {
  try {
    return await db.externalServiceRequest.create({
      data: {
        tenantId: input.tenantId,
        operation: input.operation,
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
        requestPayload: JSON.stringify(sanitizeForAudit(input.requestPayload)),
        status: "PENDING",
        requestedAt: input.now,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return db.externalServiceRequest.findUniqueOrThrow({
        where: {
          tenantId_idempotencyKey: {
            tenantId: input.tenantId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
    }
    throw err;
  }
}

export async function markExternalServiceRequestProcessing(db: Db, id: string): Promise<void> {
  await db.externalServiceRequest.update({
    where: { id },
    data: { status: "PROCESSING", attemptCount: { increment: 1 } },
  });
}

export interface CompleteExternalServiceRequestInput {
  httpStatus: number;
  externalResourceId?: string;
  responsePayload?: Record<string, unknown>;
  now: Date;
}

export async function completeExternalServiceRequest(
  db: Db,
  id: string,
  input: CompleteExternalServiceRequestInput,
): Promise<void> {
  await db.externalServiceRequest.update({
    where: { id },
    data: {
      status: "SUCCEEDED",
      httpStatus: input.httpStatus,
      respondedAt: input.now,
      ...(input.externalResourceId ? { externalResourceId: input.externalResourceId } : {}),
      ...(input.responsePayload !== undefined
        ? { responsePayload: JSON.stringify(sanitizeForAudit(input.responsePayload)) }
        : {}),
    },
  });
}

export interface FailExternalServiceRequestInput {
  status: Extract<ExternalRequestStatus, "FAILED" | "RETRY_PENDING" | "UNKNOWN" | "CANCELLED">;
  httpStatus?: number;
  errorCode?: string;
  errorMessage: string;
  nextAttemptAt?: Date;
  now: Date;
}

export async function failExternalServiceRequest(
  db: Db,
  id: string,
  input: FailExternalServiceRequestInput,
): Promise<void> {
  await db.externalServiceRequest.update({
    where: { id },
    data: {
      status: input.status,
      respondedAt: input.now,
      errorMessage: input.errorMessage,
      ...(input.httpStatus !== undefined ? { httpStatus: input.httpStatus } : {}),
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      ...(input.nextAttemptAt ? { nextAttemptAt: input.nextAttemptAt } : {}),
    },
  });
}
