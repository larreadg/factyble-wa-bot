import { prisma } from "../src/infrastructure/prisma.js";
import { getOrCreateContact } from "../src/services/contact.service.js";
import { getOrCreateConversation } from "../src/services/conversation.service.js";
import { startSession } from "../src/services/session.service.js";
import {
  appendInboundMessageIdempotently,
  queueOutboundMessage,
  markMessageSent,
} from "../src/services/message.service.js";
import {
  registerWebhookEventIdempotently,
  markWebhookProcessing,
  markWebhookProcessed,
} from "../src/services/webhook.service.js";
import {
  enqueueExternalServiceRequest,
  completeExternalServiceRequest,
} from "../src/services/external-request.service.js";
import { DuplicateMessageError, DuplicateWebhookError } from "../src/domain/errors.js";

const DEMO_TAX_ID = "DEMO-80000000";
const DEMO_PHONE_NUMBER_ID = "SEED_PHONE_NUMBER_ID";
const DEMO_WA_ID = "595981000000";

async function main(): Promise<void> {
  const now = new Date();

  const tenant = await prisma.tenant.upsert({
    where: { taxId: DEMO_TAX_ID },
    create: { name: "Factyble Demo", legalName: "Factyble Demo S.A.", taxId: DEMO_TAX_ID },
    update: {},
  });

  const account = await prisma.whatsAppAccount.upsert({
    where: { phoneNumberId: DEMO_PHONE_NUMBER_ID },
    create: {
      tenantId: tenant.id,
      phoneNumberId: DEMO_PHONE_NUMBER_ID,
      businessAccountId: "SEED_BUSINESS_ACCOUNT_ID",
      displayPhoneNumber: "+595 981 000 000",
      displayName: "Factyble Demo",
    },
    update: {},
  });

  const contact = await getOrCreateContact(prisma, {
    tenantId: tenant.id,
    waId: DEMO_WA_ID,
    phoneNumber: DEMO_WA_ID,
    profileName: "Cliente Demo",
    now,
  });

  const conversation = await getOrCreateConversation(prisma, {
    tenantId: tenant.id,
    whatsAppAccountId: account.id,
    contactId: contact.id,
    now,
  });

  const existingSession = await prisma.conversationSession.findFirst({
    where: { conversationId: conversation.id, flowType: "MAIN_MENU" },
  });

  const session =
    existingSession ??
    (await prisma.$transaction((tx) =>
      startSession(tx, {
        tenantId: tenant.id,
        conversationId: conversation.id,
        flowType: "MAIN_MENU",
        initialStep: "SELECT_OPTION",
        ttlMinutes: 15,
        now,
      }),
    ));

  try {
    const inboundMessage = await appendInboundMessageIdempotently(prisma, {
      tenantId: tenant.id,
      conversationId: conversation.id,
      sessionId: session.id,
      whatsAppAccountId: account.id,
      contactId: contact.id,
      providerMessageId: "SEED_WAMID_INBOUND_1",
      type: "TEXT",
      text: "Hola",
      receivedAt: now,
    });
    console.log(`Seeded inbound message ${inboundMessage.id}`);
  } catch (err) {
    if (!(err instanceof DuplicateMessageError)) throw err;
  }

  const outboundText =
    "¡Hola! 👋 Bienvenido a Factyble.\n\n1️⃣ Emitir factura\n2️⃣ Emitir nota de crédito\n3️⃣ Consultar factura\n4️⃣ Consultar nota de crédito";
  const existingOutbound = await prisma.message.findFirst({
    where: { conversationId: conversation.id, direction: "OUTBOUND", text: outboundText },
  });
  if (!existingOutbound) {
    const outboundMessage = await queueOutboundMessage(prisma, {
      tenantId: tenant.id,
      conversationId: conversation.id,
      sessionId: session.id,
      whatsAppAccountId: account.id,
      contactId: contact.id,
      text: outboundText,
      now,
    });
    await markMessageSent(prisma, outboundMessage.id, "SEED_WAMID_OUTBOUND_1", now);
    console.log(`Seeded outbound message ${outboundMessage.id}`);
  }

  try {
    const webhookEvent = await registerWebhookEventIdempotently(prisma, {
      tenantId: tenant.id,
      eventType: "messages",
      rawBody: Buffer.from(JSON.stringify({ seed: true, wamid: "SEED_WAMID_INBOUND_1" })),
      now,
    });
    await markWebhookProcessing(prisma, webhookEvent.id, now);
    await markWebhookProcessed(prisma, webhookEvent.id, now);
    console.log(`Seeded processed webhook event ${webhookEvent.id}`);
  } catch (err) {
    if (!(err instanceof DuplicateWebhookError)) throw err;
  }

  const externalRequest = await enqueueExternalServiceRequest(prisma, {
    tenantId: tenant.id,
    conversationId: conversation.id,
    sessionId: session.id,
    operation: "QUERY_INVOICE",
    idempotencyKey: "SEED-EXTERNAL-REQUEST-1",
    correlationId: "SEED-CORRELATION-1",
    requestPayload: { criteria: "CDC", value: "01800000000000000000000000000000000000000000" },
    now,
  });
  if (externalRequest.status === "PENDING") {
    await completeExternalServiceRequest(prisma, externalRequest.id, {
      httpStatus: 200,
      externalResourceId: "SEED-INVOICE-0001",
      responsePayload: { id: "SEED-INVOICE-0001", status: "ISSUED" },
      now,
    });
  }
  console.log(`Seeded external service request ${externalRequest.id}`);

  console.log("Seed complete.");
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
