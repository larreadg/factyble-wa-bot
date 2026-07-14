import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "../src/infrastructure/prisma.js";
import { createFixture } from "./helpers/fixtures.js";
import {
  conversationPartitionKey,
  runExclusive,
} from "../src/services/conversation-queue.service.js";
import {
  acquireSessionLock,
  startSession,
  transitionSession,
} from "../src/services/session.service.js";
import { SessionLockedError, SessionRevisionConflictError } from "../src/domain/errors.js";
import {
  claimOutboxEvents,
  enqueueOutboxEvent,
  retryOutboxEvent,
} from "../src/services/outbox.service.js";

describe("concurrency", () => {
  it("messages for the same conversation are processed strictly in order, never overlapping", async () => {
    const key = conversationPartitionKey("acct-1", `wa-${crypto.randomUUID()}`);
    const order: number[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;

    const task = (n: number) =>
      runExclusive(key, async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 5 - (n % 3)));
        order.push(n);
        concurrent--;
      });

    await Promise.all([task(1), task(2), task(3), task(4), task(5)]);

    expect(order).toEqual([1, 2, 3, 4, 5]);
    expect(maxConcurrent).toBe(1);
  });

  it("different conversations are not serialized against each other", async () => {
    const keyA = conversationPartitionKey("acct-1", `wa-${crypto.randomUUID()}`);
    const keyB = conversationPartitionKey("acct-1", `wa-${crypto.randomUUID()}`);
    let concurrent = 0;
    let sawOverlap = false;

    const task = (key: string) =>
      runExclusive(key, async () => {
        concurrent++;
        if (concurrent > 1) sawOverlap = true;
        await new Promise((resolve) => setTimeout(resolve, 20));
        concurrent--;
      });

    await Promise.all([task(keyA), task(keyB)]);
    expect(sawOverlap).toBe(true);
  });

  it("two workers cannot hold the lock on the same session at once", async () => {
    const { tenant, conversation } = await createFixture();
    const session = await prisma.$transaction((tx) =>
      startSession(tx, {
        tenantId: tenant.id,
        conversationId: conversation.id,
        flowType: "MAIN_MENU",
        initialStep: "SELECT_OPTION",
        ttlMinutes: 15,
        now: new Date(),
      }),
    );

    const now = new Date();
    const results = await Promise.allSettled([
      acquireSessionLock(prisma, session.id, "worker-a", 30, now),
      acquireSessionLock(prisma, session.id, "worker-b", 30, now),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(SessionLockedError);
  });

  it("two updates against the same revision conflict — only one wins", async () => {
    const { tenant, conversation } = await createFixture();
    const session = await prisma.$transaction((tx) =>
      startSession(tx, {
        tenantId: tenant.id,
        conversationId: conversation.id,
        flowType: "MAIN_MENU",
        initialStep: "SELECT_OPTION",
        ttlMinutes: 15,
        now: new Date(),
      }),
    );

    const attempt = () =>
      transitionSession(prisma, {
        sessionId: session.id,
        expectedRevision: 0,
        flowType: "MAIN_MENU",
        toStatus: "WAITING_INPUT",
        toStep: "SELECT_OPTION",
        context: {},
        trigger: "VALIDATION_FAILURE",
        expiresAt: session.expiresAt,
        now: new Date(),
      });

    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      SessionRevisionConflictError,
    );
  });

  it("a persistently failing outbox event is retried a bounded number of times, then marked FAILED and never reclaimed again", async () => {
    const { tenant } = await createFixture();
    const event = await enqueueOutboxEvent(prisma, {
      tenantId: tenant.id,
      aggregateType: "Test",
      aggregateId: "1",
      eventType: "ALWAYS_FAILS",
      payload: {},
    });

    // Mirrors real dispatcher usage: claim (which only picks up PENDING/RETRY_PENDING/stuck-PROCESSING), then retry.
    // availableAt backoff after each retry means a claim right away would find nothing yet, so retry directly on the known id
    // the same number of times a real bounded dispatcher loop would before giving up.
    let attempts = 0;
    for (let i = 0; i < 20; i++) {
      const current = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
      if (current.status === "FAILED") break;
      await retryOutboxEvent(event.id, `attempt ${i}`);
      attempts++;
    }

    const final = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(final.status).toBe("FAILED");
    expect(attempts).toBeLessThan(20);

    // Once FAILED, claimOutboxEvents (PENDING/RETRY_PENDING/stuck-PROCESSING only) must never pick it up again.
    const reclaimed = await claimOutboxEvents(`worker-${crypto.randomUUID()}`, 10, 30);
    expect(reclaimed.some((e) => e.id === event.id)).toBe(false);
  });
});
