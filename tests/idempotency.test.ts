import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "../src/infrastructure/prisma.js";
import { createFixture } from "./helpers/fixtures.js";
import { registerWebhookEventIdempotently } from "../src/services/webhook.service.js";
import { appendInboundMessageIdempotently } from "../src/services/message.service.js";
import {
  beginIdempotentOperation,
  completeIdempotentOperation,
} from "../src/services/idempotency.service.js";
import {
  claimOutboxEvents,
  completeOutboxEvent,
  enqueueOutboxEvent,
} from "../src/services/outbox.service.js";
import {
  DuplicateMessageError,
  DuplicateWebhookError,
  IdempotencyConflictError,
} from "../src/domain/errors.js";

describe("idempotency", () => {
  it("does not process the same webhook delivery twice", async () => {
    const { tenant } = await createFixture();
    const rawBody = Buffer.from(JSON.stringify({ hello: "world", n: Math.random() }));

    const first = await registerWebhookEventIdempotently(prisma, {
      tenantId: tenant.id,
      eventType: "messages",
      rawBody,
      now: new Date(),
    });
    expect(first.status).toBe("RECEIVED");

    await expect(
      registerWebhookEventIdempotently(prisma, {
        tenantId: tenant.id,
        eventType: "messages",
        rawBody,
        now: new Date(),
      }),
    ).rejects.toThrow(DuplicateWebhookError);

    const count = await prisma.webhookEvent.count({ where: { payloadHash: first.payloadHash } });
    expect(count).toBe(1);
  });

  it("does not register the same inbound message twice, and a duplicate never re-runs the flow", async () => {
    const { tenant, account, contact, conversation } = await createFixture();
    const providerMessageId = `wamid.${crypto.randomUUID()}`;

    const first = await appendInboundMessageIdempotently(prisma, {
      tenantId: tenant.id,
      conversationId: conversation.id,
      whatsAppAccountId: account.id,
      contactId: contact.id,
      providerMessageId,
      type: "TEXT",
      text: "hola",
      receivedAt: new Date(),
    });
    expect(first.status).toBe("RECEIVED");

    await expect(
      appendInboundMessageIdempotently(prisma, {
        tenantId: tenant.id,
        conversationId: conversation.id,
        whatsAppAccountId: account.id,
        contactId: contact.id,
        providerMessageId,
        type: "TEXT",
        text: "hola de nuevo",
        receivedAt: new Date(),
      }),
    ).rejects.toThrow(DuplicateMessageError);

    const rows = await prisma.message.findMany({ where: { providerMessageId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toBe("hola"); // the duplicate attempt's text never got persisted
  });

  it("the same idempotency key with a different payload conflicts", async () => {
    const { tenant } = await createFixture();
    const key = `key-${crypto.randomUUID()}`;

    const begin = await beginIdempotentOperation(prisma, {
      tenantId: tenant.id,
      scope: "CREATE_INVOICE",
      key,
      requestHash: "hash-a",
      now: new Date(),
    });
    expect(begin.outcome).toBe("start");

    await expect(
      beginIdempotentOperation(prisma, {
        tenantId: tenant.id,
        scope: "CREATE_INVOICE",
        key,
        requestHash: "hash-b",
        now: new Date(),
      }),
    ).rejects.toThrow(IdempotencyConflictError);
  });

  it("the same idempotency key with the same payload replays the cached outcome", async () => {
    const { tenant } = await createFixture();
    const key = `key-${crypto.randomUUID()}`;

    const begin = await beginIdempotentOperation(prisma, {
      tenantId: tenant.id,
      scope: "CREATE_INVOICE",
      key,
      requestHash: "hash-a",
      now: new Date(),
    });
    await completeIdempotentOperation(prisma, begin.record.id, {
      resourceId: "INV-1",
      now: new Date(),
    });

    const second = await beginIdempotentOperation(prisma, {
      tenantId: tenant.id,
      scope: "CREATE_INVOICE",
      key,
      requestHash: "hash-a",
      now: new Date(),
    });
    expect(second.outcome).toBe("already_completed");
    expect(second.record.resourceId).toBe("INV-1");
  });

  it("a processed outbox event is not claimed again", async () => {
    const { tenant } = await createFixture();
    const event = await enqueueOutboxEvent(prisma, {
      tenantId: tenant.id,
      aggregateType: "Test",
      aggregateId: "1",
      eventType: "TEST_EVENT",
      payload: { ok: true },
    });

    // A generous limit: other test files may leave their own PENDING outbox rows behind, and claim order is by availableAt, not insertion.
    const firstBatch = await claimOutboxEvents(`worker-${crypto.randomUUID()}`, 1000, 30);
    expect(firstBatch.some((e) => e.id === event.id)).toBe(true);

    await completeOutboxEvent(event.id);

    const secondBatch = await claimOutboxEvents(`worker-${crypto.randomUUID()}`, 1000, 30);
    expect(secondBatch.some((e) => e.id === event.id)).toBe(false);
  });
});
