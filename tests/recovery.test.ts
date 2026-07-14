import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/infrastructure/prisma.js";
import { createFixture } from "./helpers/fixtures.js";
import { getActiveSession, startSession } from "../src/services/session.service.js";
import { claimOutboxEvents, enqueueOutboxEvent } from "../src/services/outbox.service.js";
import {
  enqueueExternalServiceRequest,
  failExternalServiceRequest,
} from "../src/services/external-request.service.js";

describe("recovery after a server restart", () => {
  it("an active session is still readable through a brand-new Prisma connection", async () => {
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

    // A fresh PrismaClient stands in for "the process restarted" — nothing about
    // session state may live only in this process's memory.
    const freshClient = new PrismaClient();
    try {
      const reloaded = await getActiveSession(freshClient, conversation.id);
      expect(reloaded?.id).toBe(session.id);
      expect(reloaded?.status).toBe("ACTIVE");
    } finally {
      await freshClient.$disconnect();
    }
  });

  it("an outbox event abandoned by a crashed worker (lock expired, never completed) is reclaimed", async () => {
    const { tenant } = await createFixture();
    const event = await enqueueOutboxEvent(prisma, {
      tenantId: tenant.id,
      aggregateType: "Test",
      aggregateId: "1",
      eventType: "SEND_WHATSAPP_MESSAGE",
      payload: {},
    });

    // Simulate: worker-crashed claimed it, then died before completing.
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: "PROCESSING",
        lockedBy: "worker-crashed",
        lockedAt: new Date(Date.now() - 120_000),
        lockExpiresAt: new Date(Date.now() - 60_000),
      },
    });

    const reclaimed = await claimOutboxEvents("worker-new", 10, 30);
    expect(reclaimed.some((e) => e.id === event.id)).toBe(true);
  });

  it("an external operation left UNKNOWN after a timeout can be marked for reconciliation instead of being treated as a hard failure", async () => {
    const { tenant } = await createFixture();
    const request = await enqueueExternalServiceRequest(prisma, {
      tenantId: tenant.id,
      operation: "CREATE_INVOICE",
      idempotencyKey: `ext-${crypto.randomUUID()}`,
      correlationId: "corr-1",
      requestPayload: { a: 1 },
      now: new Date(),
    });

    await failExternalServiceRequest(prisma, request.id, {
      status: "UNKNOWN",
      errorMessage: "Timed out waiting for a response",
      now: new Date(),
    });

    const stored = await prisma.externalServiceRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(stored.status).toBe("UNKNOWN");
    // UNKNOWN (not FAILED) is exactly the signal the outbox dispatcher uses to
    // reconcile via a query call before ever retrying the mutating create call.
  });
});
