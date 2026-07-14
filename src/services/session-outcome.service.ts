import crypto from "node:crypto";
import type { ConversationSession, FlowType } from "@prisma/client";
import { prisma } from "../infrastructure/prisma.js";
import { env } from "../config/env.js";
import type { FlowResult } from "../domain/flow.js";
import type { FlowContextMap } from "../domain/session-context.js";
import {
  OUTBOX_EVENT_TYPES,
  type ExternalServiceCallPayload,
  type SendWhatsAppMessagePayload,
} from "../domain/outbox-events.js";
import { transitionSession } from "./session.service.js";
import { queueOutboundMessage } from "./message.service.js";
import { enqueueOutboxEvent } from "./outbox.service.js";
import { enqueueExternalServiceRequest } from "./external-request.service.js";
import { getFlow } from "../flows/flow-registry.js";
import { addMinutes } from "../utils/date.js";

export interface ApplyOutcomeContext {
  tenantId: string;
  conversationId: string;
  whatsAppAccountId: string;
  contactId: string;
  messageId?: string;
}

/**
 * Applies a `FlowResult` (from a real message or from an external-call
 * resumption) to a session in one short transaction: the optimistic-locked
 * session transition, any outbound messages + their outbox events, and any
 * requested external-service-call + its outbox event, all commit together
 * or not at all. No WhatsApp/billing-backend I/O happens in here — only
 * queuing. See docs/conversation-architecture.md "Orden de procesamiento".
 */
export interface ApplySessionOutcomeOptions {
  /** Overrides the default "stay results never renew the TTL" rule — used for the `ayuda` global command, which is deliberate engagement, not noise. */
  forceRenew?: boolean;
}

export async function applySessionOutcome<T extends FlowType>(
  session: ConversationSession & { flowType: T },
  result: FlowResult<FlowContextMap[T]>,
  now: Date,
  ctx: ApplyOutcomeContext,
  options?: ApplySessionOutcomeOptions,
): Promise<ConversationSession> {
  const flow = getFlow(session.flowType);
  const ttlMinutes =
    result.nextStatus === "WAITING_EXTERNAL_SERVICE"
      ? env.SESSION_EXTERNAL_WAIT_TTL_MINUTES
      : flow.ttlMinutes;
  // "stay" results are re-prompts for invalid/duplicate/waiting input and must not extend the TTL (see spec: "no renueves sesiones con... mensajes inválidos").
  const shouldRenew = options?.forceRenew ?? result.kind !== "stay";
  const expiresAt = shouldRenew ? addMinutes(now, ttlMinutes) : session.expiresAt;

  return prisma.$transaction(async (tx) => {
    const updated = await transitionSession(tx, {
      sessionId: session.id,
      expectedRevision: session.revision,
      flowType: session.flowType,
      toStatus: result.nextStatus,
      toStep: result.nextStep,
      context: result.context,
      trigger: result.trigger,
      expiresAt,
      now,
      ...(ctx.messageId ? { messageId: ctx.messageId } : {}),
      ...(result.kind === "complete" ? { completedAt: now } : {}),
      ...(result.kind === "cancel" ? { cancelledAt: now } : {}),
      ...(result.kind === "fail" ? { failedAt: now } : {}),
      ...(result.failureCode !== undefined ? { failureCode: result.failureCode } : {}),
      ...(result.failureReason !== undefined ? { failureReason: result.failureReason } : {}),
    });

    for (const draft of result.outboundMessages) {
      const message = await queueOutboundMessage(tx, {
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId,
        sessionId: session.id,
        whatsAppAccountId: ctx.whatsAppAccountId,
        contactId: ctx.contactId,
        text: draft.text,
        now,
      });

      const payload: SendWhatsAppMessagePayload = { messageId: message.id };
      await enqueueOutboxEvent(tx, {
        tenantId: ctx.tenantId,
        aggregateType: "Message",
        aggregateId: message.id,
        eventType: OUTBOX_EVENT_TYPES.SEND_WHATSAPP_MESSAGE,
        payload,
      });
    }

    if (result.externalCall) {
      const idempotencyKey = `${session.id}:${session.revision}`;
      const correlationId = crypto.randomUUID();
      const request = await enqueueExternalServiceRequest(tx, {
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId,
        sessionId: session.id,
        operation: result.externalCall.operation,
        idempotencyKey,
        correlationId,
        requestPayload: result.externalCall.requestPayload,
        now,
      });

      const payload: ExternalServiceCallPayload = {
        externalServiceRequestId: request.id,
        sessionId: session.id,
      };
      await enqueueOutboxEvent(tx, {
        tenantId: ctx.tenantId,
        aggregateType: "ExternalServiceRequest",
        aggregateId: request.id,
        eventType: OUTBOX_EVENT_TYPES.EXTERNAL_SERVICE_CALL,
        payload,
      });
    }

    if (result.kind === "handoff") {
      await tx.conversation.update({
        where: { id: ctx.conversationId },
        data: { status: "HANDOFF" },
      });
    } else if (result.kind === "complete" || result.kind === "cancel" || result.kind === "fail") {
      await tx.conversation.update({ where: { id: ctx.conversationId }, data: { status: "OPEN" } });
    }

    return updated;
  });
}
