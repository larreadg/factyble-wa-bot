import type { OutboxEvent } from "@prisma/client";
import { prisma } from "../infrastructure/prisma.js";
import type { Db } from "../infrastructure/db.js";
import { addSeconds } from "../utils/date.js";

export interface EnqueueOutboxEventInput {
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  availableAt?: Date;
}

/**
 * Writes an outbox row. Callers must do this in the SAME transaction as the
 * business mutation it accompanies (session transition, message creation,
 * etc) — that is the entire point of the transactional-outbox pattern: the
 * event only exists if the mutation committed, and vice versa.
 */
export async function enqueueOutboxEvent(
  db: Db,
  input: EnqueueOutboxEventInput,
): Promise<OutboxEvent> {
  return db.outboxEvent.create({
    data: {
      tenantId: input.tenantId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      payload: JSON.stringify(input.payload),
      ...(input.availableAt ? { availableAt: input.availableAt } : {}),
    },
  });
}

/**
 * Atomically claims up to `limit` due events for `workerId`. SQLite has no
 * `SELECT ... FOR UPDATE SKIP LOCKED`; instead this runs the
 * select-then-claim as one write transaction, which SQLite serializes
 * against any other writer, so two dispatchers (or two ticks of the same
 * poller) can never claim the same row.
 */
export async function claimOutboxEvents(
  workerId: string,
  limit: number,
  lockTtlSeconds: number,
): Promise<OutboxEvent[]> {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const candidates = await tx.outboxEvent.findMany({
      where: {
        // PROCESSING is included so an event abandoned by a crashed worker
        // (claimed, lock expired, never completed/retried) is reclaimable —
        // otherwise it would be stuck forever, since nothing else transitions
        // it out of PROCESSING. PENDING/RETRY_PENDING rows always have a null
        // lockExpiresAt, so the lock condition below is a no-op for them.
        status: { in: ["PENDING", "RETRY_PENDING", "PROCESSING"] },
        availableAt: { lte: now },
        OR: [{ lockExpiresAt: null }, { lockExpiresAt: { lte: now } }],
      },
      orderBy: { availableAt: "asc" },
      take: limit,
    });

    if (candidates.length === 0) return [];

    const lockExpiresAt = addSeconds(now, lockTtlSeconds);
    await tx.outboxEvent.updateMany({
      where: { id: { in: candidates.map((c) => c.id) } },
      data: { status: "PROCESSING", lockedAt: now, lockedBy: workerId, lockExpiresAt },
    });

    return candidates.map((c) => ({
      ...c,
      status: "PROCESSING" as const,
      lockedBy: workerId,
      lockExpiresAt,
    }));
  });
}

export async function completeOutboxEvent(id: string): Promise<void> {
  await prisma.outboxEvent.update({
    where: { id },
    data: {
      status: "PROCESSED",
      processedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lockExpiresAt: null,
    },
  });
}

const MAX_OUTBOX_ATTEMPTS = 8;

/** Exponential backoff with jitter, capped, so a persistently failing consumer never gets a busy-retry storm. */
function computeBackoffSeconds(attemptCount: number): number {
  const base = Math.min(2 ** attemptCount, 300);
  const jitter = Math.random() * base * 0.2;
  return base + jitter;
}

export async function retryOutboxEvent(id: string, error: string): Promise<void> {
  const current = await prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
  const attemptCount = current.attemptCount + 1;
  const now = new Date();

  if (attemptCount >= MAX_OUTBOX_ATTEMPTS) {
    await prisma.outboxEvent.update({
      where: { id },
      data: {
        status: "FAILED",
        attemptCount,
        lastError: error,
        lockedAt: null,
        lockedBy: null,
        lockExpiresAt: null,
      },
    });
    return;
  }

  await prisma.outboxEvent.update({
    where: { id },
    data: {
      status: "RETRY_PENDING",
      attemptCount,
      lastError: error,
      availableAt: addSeconds(now, computeBackoffSeconds(attemptCount)),
      lockedAt: null,
      lockedBy: null,
      lockExpiresAt: null,
    },
  });
}
