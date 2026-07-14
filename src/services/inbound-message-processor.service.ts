import type {
  WhatsAppContact,
  WhatsAppIncomingMessage,
  WhatsAppMessageStatus,
  WhatsAppWebhookPayload,
} from "../types/whatsapp.types.js";
import type { ConversationSession, FlowType, MessageType, WhatsAppAccount } from "@prisma/client";
import { prisma } from "../infrastructure/prisma.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { normalizeInboundMessage } from "../domain/normalized-message.js";
import { matchGlobalCommand, type GlobalCommand } from "../domain/global-commands.js";
import { DuplicateMessageError, DuplicateWebhookError } from "../domain/errors.js";
import type { FlowResult } from "../domain/flow.js";
import type { FlowContextMap } from "../domain/session-context.js";
import { OUTBOX_EVENT_TYPES, type SendWhatsAppMessagePayload } from "../domain/outbox-events.js";
import {
  getOrCreateDefaultTenantAndAccount,
  getWhatsAppAccountByPhoneNumberId,
} from "./whatsapp-account.service.js";
import { getOrCreateContact } from "./contact.service.js";
import { getOrCreateConversation } from "./conversation.service.js";
import {
  appendInboundMessageIdempotently,
  queueOutboundMessage,
  recordMessageStatus,
} from "./message.service.js";
import {
  registerWebhookEventIdempotently,
  markWebhookProcessing,
  markWebhookProcessed,
  markWebhookFailed,
} from "./webhook.service.js";
import {
  acquireSessionLock,
  releaseSessionLock,
  getActiveSession,
  startSession,
  expireSession,
  getSessionById,
  isActiveStatus,
  typedContext,
} from "./session.service.js";
import { toFlowSessionView } from "./flow-session-view.js";
import { applySessionOutcome, type ApplyOutcomeContext } from "./session-outcome.service.js";
import { enqueueOutboxEvent } from "./outbox.service.js";
import { getFlow } from "../flows/flow-registry.js";
import { MENU_MESSAGE } from "../flows/main-menu.flow.js";
import { conversationPartitionKey, runExclusive } from "./conversation-queue.service.js";
import { whatsappService } from "./whatsapp.service.js";

const WORKER_ID = `webhook:${process.pid}`;

const MESSAGE_TYPE_MAP: Record<WhatsAppIncomingMessage["type"], MessageType> = {
  text: "TEXT",
  image: "IMAGE",
  audio: "AUDIO",
  video: "VIDEO",
  document: "DOCUMENT",
  sticker: "UNKNOWN",
  location: "LOCATION",
  button: "INTERACTIVE",
  interactive: "INTERACTIVE",
  reaction: "REACTION",
  unknown: "UNKNOWN",
};

const FLOW_TYPES: readonly FlowType[] = [
  "MAIN_MENU",
  "CREATE_INVOICE",
  "QUERY_INVOICE",
  "CREATE_CREDIT_NOTE",
  "QUERY_CREDIT_NOTE",
];

function isFlowType(value: string): value is FlowType {
  return (FLOW_TYPES as readonly string[]).includes(value);
}

interface ConversationRefs {
  tenantId: string;
  conversationId: string;
  whatsAppAccountId: string;
  contactId: string;
}

/**
 * Entry point called once per received webhook HTTP request, after the
 * controller has already sent `200 OK` back to Meta (see webhook.controller.ts).
 * Persists the delivery first (idempotent on payloadHash), then fans out to
 * per-message processing. A failure processing one message never blocks the
 * others in the same payload — each is caught and logged individually.
 */
export async function processWebhookPayload(
  rawBody: Buffer,
  payload: WhatsAppWebhookPayload,
): Promise<void> {
  const now = new Date();
  let webhookEventId: string;

  try {
    const webhookEvent = await registerWebhookEventIdempotently(prisma, {
      eventType: payload.entry?.[0]?.changes?.[0]?.field ?? "unknown",
      rawBody,
      now,
    });
    webhookEventId = webhookEvent.id;
  } catch (err) {
    if (err instanceof DuplicateWebhookError) {
      logger.info({ err: err.message }, "Duplicate webhook delivery ignored");
      return;
    }
    throw err;
  }

  await markWebhookProcessing(prisma, webhookEventId, now);

  try {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const phoneNumberId = change.value.metadata.phone_number_id;
        const contacts = change.value.contacts ?? [];

        for (const status of change.value.statuses ?? []) {
          await processStatusUpdate(phoneNumberId, status).catch((err: unknown) => {
            logger.error({ err }, "Failed to process WhatsApp status update");
          });
        }

        for (const message of change.value.messages ?? []) {
          const contact = contacts.find((c) => c.wa_id === message.from);
          await processInboundMessage(phoneNumberId, message, contact).catch((err: unknown) => {
            logger.error(
              { err, providerMessageId: message.id },
              "Failed to process inbound WhatsApp message",
            );
          });
        }
      }
    }
    await markWebhookProcessed(prisma, webhookEventId, new Date());
  } catch (err) {
    await markWebhookFailed(
      prisma,
      webhookEventId,
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
}

async function processStatusUpdate(
  phoneNumberId: string,
  status: WhatsAppMessageStatus,
): Promise<void> {
  const account = await getWhatsAppAccountByPhoneNumberId(phoneNumberId);
  if (!account) return;

  await recordMessageStatus(prisma, {
    whatsAppAccountId: account.id,
    providerMessageId: status.id,
    providerStatus: status.status,
    providerTimestamp: new Date(Number(status.timestamp) * 1000),
    payload: status,
    ...(status.status === "failed"
      ? {
          ...(status.errors[0]?.code !== undefined
            ? { errorCode: String(status.errors[0].code) }
            : {}),
          ...(status.errors[0]?.title !== undefined ? { errorTitle: status.errors[0].title } : {}),
          ...(status.errors[0]?.message !== undefined
            ? { errorDetails: status.errors[0].message }
            : {}),
        }
      : {}),
  });
}

async function resolveAccount(phoneNumberId: string): Promise<WhatsAppAccount> {
  const existing = await getWhatsAppAccountByPhoneNumberId(phoneNumberId);
  if (existing) return existing;

  const defaults = await getOrCreateDefaultTenantAndAccount();
  return prisma.whatsAppAccount.findUniqueOrThrow({ where: { id: defaults.whatsAppAccountId } });
}

async function processInboundMessage(
  phoneNumberId: string,
  rawMessage: WhatsAppIncomingMessage,
  waContact: WhatsAppContact | undefined,
): Promise<void> {
  const account = await resolveAccount(phoneNumberId);
  const partitionKey = conversationPartitionKey(account.id, rawMessage.from);
  await runExclusive(partitionKey, () =>
    handleSingleInboundMessage(account, rawMessage, waContact),
  );
}

async function handleSingleInboundMessage(
  account: WhatsAppAccount,
  rawMessage: WhatsAppIncomingMessage,
  waContact: WhatsAppContact | undefined,
): Promise<void> {
  const now = new Date();
  const normalized = normalizeInboundMessage(rawMessage);
  const receivedAt = new Date(Number(rawMessage.timestamp) * 1000);

  const outcome = await prisma.$transaction(async (tx) => {
    const contact = await getOrCreateContact(tx, {
      tenantId: account.tenantId,
      waId: rawMessage.from,
      phoneNumber: rawMessage.from,
      now,
      ...(waContact?.profile.name ? { profileName: waContact.profile.name } : {}),
    });
    const conversation = await getOrCreateConversation(tx, {
      tenantId: account.tenantId,
      whatsAppAccountId: account.id,
      contactId: contact.id,
      now,
    });

    try {
      const message = await appendInboundMessageIdempotently(tx, {
        tenantId: account.tenantId,
        conversationId: conversation.id,
        whatsAppAccountId: account.id,
        contactId: contact.id,
        providerMessageId: rawMessage.id,
        type: MESSAGE_TYPE_MAP[rawMessage.type],
        payload: rawMessage,
        receivedAt,
        ...(normalized.text ? { text: normalized.text } : {}),
      });
      return { contact, conversation, messageId: message.id, isDuplicate: false as const };
    } catch (err) {
      if (err instanceof DuplicateMessageError) {
        return { contact, conversation, messageId: null, isDuplicate: true as const };
      }
      throw err;
    }
  });

  if (outcome.isDuplicate || !outcome.messageId) {
    logger.info(
      { providerMessageId: rawMessage.id },
      "Duplicate inbound message ignored — flow not re-run",
    );
    return;
  }

  await whatsappService
    .markAsRead(rawMessage.id)
    .catch((err: unknown) => logger.warn({ err }, "Failed to mark message as read"));

  const refs: ConversationRefs = {
    tenantId: account.tenantId,
    conversationId: outcome.conversation.id,
    whatsAppAccountId: account.id,
    contactId: outcome.contact.id,
  };

  const activeSession = await getActiveSession(prisma, outcome.conversation.id);
  if (!activeSession) {
    await createAndPromptMainMenu(refs, now);
    return;
  }

  let lockedSession = await acquireSessionLock(
    prisma,
    activeSession.id,
    WORKER_ID,
    env.SESSION_LOCK_TTL_SECONDS,
    now,
  );

  try {
    lockedSession = await getSessionById(prisma, lockedSession.id);

    if (lockedSession.expiresAt <= now && isActiveStatus(lockedSession.status)) {
      await expireSession(prisma, lockedSession, now);
      await createAndPromptMainMenu(refs, now, "Tu sesión anterior expiró por inactividad.");
      return;
    }

    const globalCommand = matchGlobalCommand(normalized.normalizedText);
    const outcomeCtx: ApplyOutcomeContext = { ...refs, messageId: outcome.messageId };

    if (globalCommand) {
      await applyGlobalCommand(lockedSession, globalCommand, outcomeCtx, now, refs);
      return;
    }

    const flow = getFlow(lockedSession.flowType);
    const view = toFlowSessionView(lockedSession);
    const result = await flow.handle({ session: view, message: normalized, now });
    await applySessionOutcome(lockedSession, result, now, outcomeCtx);

    if (lockedSession.flowType === "MAIN_MENU" && result.kind === "complete") {
      const selectedOption = (result.context as { selectedOption?: string }).selectedOption;
      if (selectedOption && isFlowType(selectedOption)) {
        await startFlowSessionAndPrompt(refs, selectedOption, now);
      }
    }
  } finally {
    await releaseSessionLock(prisma, lockedSession.id, WORKER_ID);
  }
}

async function applyGlobalCommand<T extends FlowType>(
  session: ConversationSession & { flowType: T },
  command: GlobalCommand,
  ctx: ApplyOutcomeContext,
  now: Date,
  refs: ConversationRefs,
): Promise<void> {
  const context = typedContext(session);

  switch (command) {
    case "HELP": {
      const flow = getFlow(session.flowType);
      const result: FlowResult<FlowContextMap[T]> = {
        kind: "stay",
        nextStep: session.currentStep,
        nextStatus: session.status,
        context,
        trigger: "SYSTEM_EVENT",
        outboundMessages: [{ type: "text", text: flow.helpMessage(session.currentStep) }],
      };
      // "ayuda" is deliberate engagement, unlike other "stay" results (invalid input, duplicate) — it should renew the TTL.
      await applySessionOutcome(session, result, now, ctx, { forceRenew: true });
      return;
    }
    case "HANDOFF": {
      const result: FlowResult<FlowContextMap[T]> = {
        kind: "handoff",
        nextStep: session.currentStep,
        nextStatus: "HANDOFF",
        context,
        trigger: "HANDOFF",
        outboundMessages: [
          { type: "text", text: "Te comunico con un asesor humano. En breve te contactaremos 🙂" },
        ],
      };
      await applySessionOutcome(session, result, now, ctx);
      return;
    }
    case "CANCEL": {
      const result: FlowResult<FlowContextMap[T]> = {
        kind: "cancel",
        nextStep: session.currentStep,
        nextStatus: "CANCELLED",
        context,
        trigger: "CANCEL_COMMAND",
        outboundMessages: [
          { type: "text", text: "Operación cancelada. Escribí *menu* para volver a empezar." },
        ],
      };
      await applySessionOutcome(session, result, now, ctx);
      return;
    }
    case "MENU":
    case "RESTART": {
      const result: FlowResult<FlowContextMap[T]> = {
        kind: "cancel",
        nextStep: session.currentStep,
        nextStatus: "CANCELLED",
        context,
        trigger: "CANCEL_COMMAND",
        outboundMessages: [],
      };
      await applySessionOutcome(session, result, now, ctx);
      await createAndPromptMainMenu(
        refs,
        now,
        command === "RESTART" ? "Reiniciando la conversación." : undefined,
      );
      return;
    }
  }
}

async function createAndPromptMainMenu(
  refs: ConversationRefs,
  now: Date,
  prefix?: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const flow = getFlow("MAIN_MENU");
    const session = await startSession(tx, {
      tenantId: refs.tenantId,
      conversationId: refs.conversationId,
      flowType: "MAIN_MENU",
      initialStep: flow.initialStep,
      ttlMinutes: flow.ttlMinutes,
      now,
    });

    const text = prefix ? `${prefix}\n\n${MENU_MESSAGE}` : MENU_MESSAGE;
    const message = await queueOutboundMessage(tx, {
      tenantId: refs.tenantId,
      conversationId: refs.conversationId,
      sessionId: session.id,
      whatsAppAccountId: refs.whatsAppAccountId,
      contactId: refs.contactId,
      text,
      now,
    });

    const payload: SendWhatsAppMessagePayload = { messageId: message.id };
    await enqueueOutboxEvent(tx, {
      tenantId: refs.tenantId,
      aggregateType: "Message",
      aggregateId: message.id,
      eventType: OUTBOX_EVENT_TYPES.SEND_WHATSAPP_MESSAGE,
      payload,
    });
  });
}

async function startFlowSessionAndPrompt(
  refs: ConversationRefs,
  flowType: FlowType,
  now: Date,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const flow = getFlow(flowType);
    const session = await startSession(tx, {
      tenantId: refs.tenantId,
      conversationId: refs.conversationId,
      flowType,
      initialStep: flow.initialStep,
      ttlMinutes: flow.ttlMinutes,
      now,
    });

    const message = await queueOutboundMessage(tx, {
      tenantId: refs.tenantId,
      conversationId: refs.conversationId,
      sessionId: session.id,
      whatsAppAccountId: refs.whatsAppAccountId,
      contactId: refs.contactId,
      text: flow.helpMessage(flow.initialStep),
      now,
    });

    const payload: SendWhatsAppMessagePayload = { messageId: message.id };
    await enqueueOutboxEvent(tx, {
      tenantId: refs.tenantId,
      aggregateType: "Message",
      aggregateId: message.id,
      eventType: OUTBOX_EVENT_TYPES.SEND_WHATSAPP_MESSAGE,
      payload,
    });
  });
}
