import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "../src/infrastructure/prisma.js";
import { createFixture } from "./helpers/fixtures.js";
import {
  appendInboundMessageIdempotently,
  markMessageFailed,
  queueOutboundMessage,
  recordMessageStatus,
  shouldApplyStatusTransition,
} from "../src/services/message.service.js";
import { enqueueOutboxEvent } from "../src/services/outbox.service.js";

describe("messages", () => {
  it("registers an inbound message with RECEIVED status", async () => {
    const { tenant, account, contact, conversation } = await createFixture();
    const message = await appendInboundMessageIdempotently(prisma, {
      tenantId: tenant.id,
      conversationId: conversation.id,
      whatsAppAccountId: account.id,
      contactId: contact.id,
      providerMessageId: `wamid.${crypto.randomUUID()}`,
      type: "TEXT",
      text: "hola",
      receivedAt: new Date(),
    });

    expect(message.direction).toBe("INBOUND");
    expect(message.status).toBe("RECEIVED");
  });

  it("creates an outbound message in QUEUED status and an accompanying outbox event", async () => {
    const { tenant, account, contact, conversation } = await createFixture();

    const { message, event } = await prisma.$transaction(async (tx) => {
      const message = await queueOutboundMessage(tx, {
        tenantId: tenant.id,
        conversationId: conversation.id,
        whatsAppAccountId: account.id,
        contactId: contact.id,
        text: "Bienvenido",
        now: new Date(),
      });
      const event = await enqueueOutboxEvent(tx, {
        tenantId: tenant.id,
        aggregateType: "Message",
        aggregateId: message.id,
        eventType: "SEND_WHATSAPP_MESSAGE",
        payload: { messageId: message.id },
      });
      return { message, event };
    });

    expect(message.direction).toBe("OUTBOUND");
    expect(message.status).toBe("QUEUED");
    expect(event.status).toBe("PENDING");
    expect(event.aggregateId).toBe(message.id);
  });

  it("status transition hierarchy: READ never regresses to DELIVERED, DELIVERED never regresses to SENT", () => {
    expect(shouldApplyStatusTransition("SENT", "DELIVERED")).toBe(true);
    expect(shouldApplyStatusTransition("DELIVERED", "READ")).toBe(true);
    expect(shouldApplyStatusTransition("READ", "DELIVERED")).toBe(false);
    expect(shouldApplyStatusTransition("DELIVERED", "SENT")).toBe(false);
    expect(shouldApplyStatusTransition("READ", "FAILED")).toBe(false);
    expect(shouldApplyStatusTransition("SENT", "FAILED")).toBe(true);
  });

  it("out-of-order status callbacks do not downgrade the stored message status", async () => {
    const { tenant, account, contact, conversation } = await createFixture();
    const message = await queueOutboundMessage(prisma, {
      tenantId: tenant.id,
      conversationId: conversation.id,
      whatsAppAccountId: account.id,
      contactId: contact.id,
      text: "Hola",
      now: new Date(),
    });
    const providerMessageId = `wamid.${crypto.randomUUID()}`;
    await prisma.message.update({
      where: { id: message.id },
      data: { providerMessageId, status: "SENT" },
    });

    await recordMessageStatus(prisma, {
      whatsAppAccountId: account.id,
      providerMessageId,
      providerStatus: "read",
      providerTimestamp: new Date(),
    });

    await recordMessageStatus(prisma, {
      whatsAppAccountId: account.id,
      providerMessageId,
      providerStatus: "delivered",
      providerTimestamp: new Date(),
    });

    const final = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(final.status).toBe("READ");

    const events = await prisma.messageStatusEvent.findMany({ where: { messageId: message.id } });
    expect(events).toHaveLength(2); // both callbacks are recorded in full history regardless
  });

  it("a failed message keeps a sanitized error message and code", async () => {
    const { tenant, account, contact, conversation } = await createFixture();
    const message = await queueOutboundMessage(prisma, {
      tenantId: tenant.id,
      conversationId: conversation.id,
      whatsAppAccountId: account.id,
      contactId: contact.id,
      text: "Hola",
      now: new Date(),
    });

    await markMessageFailed(
      prisma,
      message.id,
      "131026",
      "Message undeliverable: recipient number not on WhatsApp",
      new Date(),
    );

    const failed = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.errorCode).toBe("131026");
    expect(failed.errorMessage).toContain("undeliverable");
    expect(failed.failedAt).not.toBeNull();
  });
});
