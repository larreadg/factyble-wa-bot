import crypto from "node:crypto";
import { prisma } from "../../src/infrastructure/prisma.js";
import type { Contact, Conversation, Tenant, WhatsAppAccount } from "@prisma/client";

export interface Fixture {
  tenant: Tenant;
  account: WhatsAppAccount;
  contact: Contact;
  conversation: Conversation;
}

/** Creates a fully isolated tenant/account/contact/conversation quadruple for a single test — unique ids per call so tests never collide. */
export async function createFixture(): Promise<Fixture> {
  const unique = crypto.randomUUID();
  const now = new Date();

  const tenant = await prisma.tenant.create({
    data: {
      name: `Test Tenant ${unique}`,
      legalName: `Test Tenant ${unique} S.A.`,
      taxId: `TAX-${unique}`,
    },
  });

  const account = await prisma.whatsAppAccount.create({
    data: {
      tenantId: tenant.id,
      phoneNumberId: `PHONE-${unique}`,
      businessAccountId: `BIZ-${unique}`,
      displayPhoneNumber: "+595900000000",
    },
  });

  const contact = await prisma.contact.create({
    data: { tenantId: tenant.id, waId: `WA-${unique}`, phoneNumber: "595900000000" },
  });

  const conversation = await prisma.conversation.create({
    data: {
      tenantId: tenant.id,
      whatsAppAccountId: account.id,
      contactId: contact.id,
      status: "OPEN",
      startedAt: now,
      lastMessageAt: now,
    },
  });

  return { tenant, account, contact, conversation };
}
