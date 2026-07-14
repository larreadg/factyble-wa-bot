import type { ExternalServiceRequest, OutboxEvent } from "@prisma/client";
import { prisma } from "../infrastructure/prisma.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { claimOutboxEvents, completeOutboxEvent, retryOutboxEvent } from "./outbox.service.js";
import { markMessageFailed, markMessageSent } from "./message.service.js";
import {
  completeExternalServiceRequest,
  failExternalServiceRequest,
  markExternalServiceRequestProcessing,
} from "./external-request.service.js";
import { acquireSessionLock, getSessionById, releaseSessionLock } from "./session.service.js";
import { toFlowSessionView } from "./flow-session-view.js";
import { applySessionOutcome, type ApplyOutcomeContext } from "./session-outcome.service.js";
import { getFlow } from "../flows/flow-registry.js";
import { systemTriggeredMessage } from "../domain/normalized-message.js";
import type { ExternalCallOutcome } from "../domain/flow.js";
import {
  OUTBOX_EVENT_TYPES,
  type ExternalServiceCallPayload,
  type SendWhatsAppMessagePayload,
} from "../domain/outbox-events.js";
import {
  ExternalOperationUncertainError,
  ExternalServiceUnavailableError,
  SessionLockedError,
} from "../domain/errors.js";
import {
  billingBackendClient,
  type ExternalRequestOptions,
} from "../clients/billing-backend.client.js";
import { whatsappService } from "./whatsapp.service.js";
import {
  createCreditNotePayloadSchema,
  createInvoicePayloadSchema,
  queryCreditNotePayloadSchema,
  queryInvoicePayloadSchema,
} from "../domain/external-payload.js";

const WORKER_ID = `outbox:${process.pid}`;
const BATCH_SIZE = 10;
const POLL_INTERVAL_MS = 2000;
const LOCK_TTL_SECONDS = 60;

async function dispatchSendWhatsAppMessage(event: OutboxEvent): Promise<void> {
  const payload = JSON.parse(event.payload) as SendWhatsAppMessagePayload;
  const message = await prisma.message.findUniqueOrThrow({
    where: { id: payload.messageId },
    include: { contact: true },
  });

  if (message.status === "SENT" || message.status === "DELIVERED" || message.status === "READ") {
    // Already sent by a previous (interrupted) attempt at completing this outbox event.
    await completeOutboxEvent(event.id);
    return;
  }

  try {
    const { messageId: providerMessageId } = await whatsappService.sendTextMessage(
      message.contact.phoneNumber,
      message.text ?? "",
    );
    await markMessageSent(prisma, message.id, providerMessageId, new Date());
    await completeOutboxEvent(event.id);
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error sending WhatsApp message";
    await markMessageFailed(prisma, message.id, undefined, errorMessage, new Date());
    await retryOutboxEvent(event.id, errorMessage);
  }
}

/** For a CREATE_* operation whose previous attempt was left UNKNOWN (timeout), check the backend for an existing resource before retrying — never blindly re-issue a mutating call. */
async function reconcileUncertainRequest(
  request: ExternalServiceRequest,
  options: ExternalRequestOptions,
): Promise<ExternalCallOutcome | null> {
  try {
    if (request.operation === "CREATE_INVOICE") {
      const result = await billingBackendClient.queryInvoices(
        { criteria: "EXTERNAL_ID", value: request.idempotencyKey },
        options,
      );
      const id = result.raw["id"];
      if (typeof id === "string")
        return { succeeded: true, externalResourceId: id, responsePayload: result.raw };
    } else if (request.operation === "CREATE_CREDIT_NOTE") {
      const result = await billingBackendClient.queryCreditNotes(
        { criteria: "EXTERNAL_ID", value: request.idempotencyKey },
        options,
      );
      const id = result.raw["id"];
      if (typeof id === "string")
        return { succeeded: true, externalResourceId: id, responsePayload: result.raw };
    }
    return null;
  } catch (err) {
    logger.warn({ err, requestId: request.id }, "Reconciliation query failed — will retry later");
    return null;
  }
}

async function callBillingBackend(
  request: ExternalServiceRequest,
  options: ExternalRequestOptions,
): Promise<ExternalCallOutcome> {
  const requestPayload = JSON.parse(request.requestPayload) as Record<string, unknown>;

  switch (request.operation) {
    case "CREATE_INVOICE": {
      const input = createInvoicePayloadSchema.parse(requestPayload);
      const result = await billingBackendClient.createInvoice(input, options);
      return {
        succeeded: true,
        externalResourceId: result.externalInvoiceId,
        responsePayload: result.raw,
      };
    }
    case "QUERY_INVOICE": {
      const input = queryInvoicePayloadSchema.parse(requestPayload);
      const result = await billingBackendClient.queryInvoices(input, options);
      return { succeeded: true, responsePayload: result.raw };
    }
    case "CREATE_CREDIT_NOTE": {
      const input = createCreditNotePayloadSchema.parse(requestPayload);
      const result = await billingBackendClient.createCreditNote(input, options);
      return {
        succeeded: true,
        externalResourceId: result.externalCreditNoteId,
        responsePayload: result.raw,
      };
    }
    case "QUERY_CREDIT_NOTE": {
      const input = queryCreditNotePayloadSchema.parse(requestPayload);
      const result = await billingBackendClient.queryCreditNotes(input, options);
      return { succeeded: true, responsePayload: result.raw };
    }
  }
}

async function resumeSessionWithOutcome(
  sessionId: string,
  outcome: ExternalCallOutcome,
  now: Date,
): Promise<void> {
  const locked = await acquireSessionLock(prisma, sessionId, WORKER_ID, LOCK_TTL_SECONDS, now);
  try {
    const session = await getSessionById(prisma, locked.id);
    const flow = getFlow(session.flowType);
    const view = toFlowSessionView(session);
    const result = await flow.handleExternalResult(
      { session: view, message: systemTriggeredMessage(), now },
      outcome,
    );

    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: session.conversationId },
    });
    const ctx: ApplyOutcomeContext = {
      tenantId: session.tenantId,
      conversationId: session.conversationId,
      whatsAppAccountId: conversation.whatsAppAccountId,
      contactId: conversation.contactId,
    };

    await applySessionOutcome(session, result, now, ctx);
  } finally {
    await releaseSessionLock(prisma, sessionId, WORKER_ID);
  }
}

async function dispatchExternalServiceCall(event: OutboxEvent): Promise<void> {
  const payload = JSON.parse(event.payload) as ExternalServiceCallPayload;
  const now = new Date();
  const request = await prisma.externalServiceRequest.findUniqueOrThrow({
    where: { id: payload.externalServiceRequestId },
  });

  if (request.status === "SUCCEEDED" || request.status === "FAILED") {
    // A previous attempt completed the call but didn't finish closing out the outbox event — resume from the stored result instead of calling again.
    const outcome: ExternalCallOutcome =
      request.status === "SUCCEEDED"
        ? {
            succeeded: true,
            ...(request.externalResourceId
              ? { externalResourceId: request.externalResourceId }
              : {}),
            ...(request.responsePayload
              ? { responsePayload: JSON.parse(request.responsePayload) as Record<string, unknown> }
              : {}),
          }
        : {
            succeeded: false,
            ...(request.errorCode ? { errorCode: request.errorCode } : {}),
            errorMessage: request.errorMessage ?? "External operation failed",
          };
    await resumeSessionWithOutcome(payload.sessionId, outcome, now);
    await completeOutboxEvent(event.id);
    return;
  }

  const options: ExternalRequestOptions = {
    idempotencyKey: request.idempotencyKey,
    correlationId: request.correlationId,
    timeoutMs: env.BILLING_BACKEND_TIMEOUT_MS,
  };

  await markExternalServiceRequestProcessing(prisma, request.id);

  try {
    let outcome: ExternalCallOutcome | null = null;

    if (request.status === "UNKNOWN") {
      outcome = await reconcileUncertainRequest(request, options);
    }

    outcome ??= await callBillingBackend(request, options);

    await completeExternalServiceRequest(prisma, request.id, {
      httpStatus: 200,
      now,
      ...(outcome.externalResourceId ? { externalResourceId: outcome.externalResourceId } : {}),
      ...(outcome.responsePayload ? { responsePayload: outcome.responsePayload } : {}),
    });
    await resumeSessionWithOutcome(payload.sessionId, outcome, now);
    await completeOutboxEvent(event.id);
  } catch (err) {
    if (err instanceof ExternalOperationUncertainError) {
      await failExternalServiceRequest(prisma, request.id, {
        status: "UNKNOWN",
        errorMessage: err.message,
        now,
      });
      await retryOutboxEvent(event.id, err.message);
      return;
    }
    if (err instanceof ExternalServiceUnavailableError) {
      await failExternalServiceRequest(prisma, request.id, {
        status: "RETRY_PENDING",
        errorMessage: err.message,
        now,
      });
      await retryOutboxEvent(event.id, err.message);
      return;
    }
    if (err instanceof SessionLockedError) {
      // Another worker is already handling this session — safe to retry shortly, nothing was lost.
      await retryOutboxEvent(event.id, err.message);
      return;
    }

    const message = err instanceof Error ? err.message : "Unknown error calling billing backend";
    logger.error(
      { err, requestId: request.id },
      "Unexpected error resolving external service request",
    );
    await failExternalServiceRequest(prisma, request.id, {
      status: "FAILED",
      errorMessage: message,
      now,
    });
    await resumeSessionWithOutcome(
      payload.sessionId,
      { succeeded: false, errorMessage: message },
      now,
    );
    await completeOutboxEvent(event.id);
  }
}

async function dispatchOne(event: OutboxEvent): Promise<void> {
  switch (event.eventType) {
    case OUTBOX_EVENT_TYPES.SEND_WHATSAPP_MESSAGE:
      await dispatchSendWhatsAppMessage(event);
      return;
    case OUTBOX_EVENT_TYPES.EXTERNAL_SERVICE_CALL:
      await dispatchExternalServiceCall(event);
      return;
    default:
      logger.error(
        { eventType: event.eventType, id: event.id },
        "Unknown outbox event type — marking failed",
      );
      await retryOutboxEvent(event.id, `Unknown event type: ${event.eventType}`);
  }
}

async function tick(): Promise<void> {
  const events = await claimOutboxEvents(WORKER_ID, BATCH_SIZE, LOCK_TTL_SECONDS);
  for (const event of events) {
    await dispatchOne(event).catch((err: unknown) => {
      logger.error({ err, eventId: event.id }, "Unhandled error dispatching outbox event");
    });
  }
}

/** Starts the in-process outbox poller. Returns a function that stops it — call on graceful shutdown. */
export function startOutboxDispatcher(): () => void {
  let stopped = false;

  const loop = (): void => {
    if (stopped) return;
    tick()
      .catch((err: unknown) => logger.error({ err }, "Outbox dispatcher tick failed"))
      .finally(() => {
        if (!stopped) setTimeout(loop, POLL_INTERVAL_MS);
      });
  };

  loop();

  return () => {
    stopped = true;
  };
}
