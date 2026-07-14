import type { IdempotencyRecord, IdempotencyScope } from "@prisma/client";
import type { Db } from "../infrastructure/db.js";
import { IdempotencyConflictError } from "../domain/errors.js";
import { addMinutes } from "../utils/date.js";

export interface BeginIdempotentOperationInput {
  tenantId: string;
  scope: IdempotencyScope;
  key: string;
  requestHash: string;
  now: Date;
  ttlMinutes?: number;
}

export type IdempotencyBeginResult =
  | { outcome: "start"; record: IdempotencyRecord }
  | { outcome: "already_completed"; record: IdempotencyRecord }
  | { outcome: "in_progress"; record: IdempotencyRecord };

/**
 * General-purpose idempotency gate, keyed by (tenantId, scope, key). Used
 * for the two mutating billing operations (CREATE_INVOICE, CREATE_CREDIT_NOTE):
 * a retried confirmation must not create a second invoice. Same key + same
 * request payload replays the cached outcome; same key + a *different*
 * payload is a programming error or a client bug and throws
 * `IdempotencyConflictError` rather than silently doing one or the other.
 */
export async function beginIdempotentOperation(
  db: Db,
  input: BeginIdempotentOperationInput,
): Promise<IdempotencyBeginResult> {
  const existing = await db.idempotencyRecord.findUnique({
    where: { tenantId_scope_key: { tenantId: input.tenantId, scope: input.scope, key: input.key } },
  });

  if (!existing) {
    const record = await db.idempotencyRecord.create({
      data: {
        tenantId: input.tenantId,
        scope: input.scope,
        key: input.key,
        requestHash: input.requestHash,
        status: "PROCESSING",
        lockedAt: input.now,
        ...(input.ttlMinutes ? { expiresAt: addMinutes(input.now, input.ttlMinutes) } : {}),
      },
    });
    return { outcome: "start", record };
  }

  if (existing.requestHash !== input.requestHash) {
    throw new IdempotencyConflictError(input.scope, input.key);
  }

  if (existing.status === "COMPLETED") {
    return { outcome: "already_completed", record: existing };
  }

  if (existing.status === "PROCESSING") {
    return { outcome: "in_progress", record: existing };
  }

  // FAILED or EXPIRED: allow a fresh attempt under the same key.
  const record = await db.idempotencyRecord.update({
    where: { id: existing.id },
    data: { status: "PROCESSING", lockedAt: input.now },
  });
  return { outcome: "start", record };
}

export interface CompleteIdempotentOperationInput {
  resourceType?: string;
  resourceId?: string;
  responseStatusCode?: number;
  responseBody?: unknown;
  now: Date;
}

export async function completeIdempotentOperation(
  db: Db,
  id: string,
  input: CompleteIdempotentOperationInput,
): Promise<void> {
  await db.idempotencyRecord.update({
    where: { id },
    data: {
      status: "COMPLETED",
      completedAt: input.now,
      ...(input.resourceType ? { resourceType: input.resourceType } : {}),
      ...(input.resourceId ? { resourceId: input.resourceId } : {}),
      ...(input.responseStatusCode !== undefined
        ? { responseStatusCode: input.responseStatusCode }
        : {}),
      ...(input.responseBody !== undefined
        ? { responseBody: JSON.stringify(input.responseBody) }
        : {}),
    },
  });
}

export async function failIdempotentOperation(db: Db, id: string): Promise<void> {
  await db.idempotencyRecord.update({ where: { id }, data: { status: "FAILED" } });
}
