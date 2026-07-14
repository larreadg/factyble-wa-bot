import type { WhatsAppAccount } from "@prisma/client";
import { prisma } from "../infrastructure/prisma.js";
import { env } from "../config/env.js";
import { isUniqueConstraintError } from "../utils/prisma-errors.js";

export interface TenantAndAccount {
  tenantId: string;
  whatsAppAccountId: string;
}

let cached: TenantAndAccount | null = null;

/**
 * Resolves the Tenant + WhatsAppAccount for the single number this process
 * is configured for (`WHATSAPP_PHONE_NUMBER_ID`). Self-provisions both rows
 * on first use so a fresh database works without a manual seed step — this
 * mirrors the multi-tenant schema while today's deployment genuinely has one
 * tenant, one number. Memoized in-process; the underlying unique constraints
 * make the provisioning step itself idempotent under concurrent callers.
 */
export async function getOrCreateDefaultTenantAndAccount(): Promise<TenantAndAccount> {
  if (cached) return cached;

  const existing = await prisma.whatsAppAccount.findUnique({
    where: { phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID },
  });

  if (existing) {
    cached = { tenantId: existing.tenantId, whatsAppAccountId: existing.id };
    return cached;
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.upsert({
        where: { taxId: `DEFAULT-${env.WHATSAPP_BUSINESS_ACCOUNT_ID}` },
        create: {
          name: "Factyble",
          legalName: "Factyble S.A.",
          taxId: `DEFAULT-${env.WHATSAPP_BUSINESS_ACCOUNT_ID}`,
        },
        update: {},
      });

      const account = await tx.whatsAppAccount.create({
        data: {
          tenantId: tenant.id,
          phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
          businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID,
          displayPhoneNumber: env.WHATSAPP_PHONE_NUMBER_ID,
        },
      });

      return { tenantId: tenant.id, whatsAppAccountId: account.id };
    });

    cached = created;
    return created;
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      const account = await prisma.whatsAppAccount.findUniqueOrThrow({
        where: { phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID },
      });
      cached = { tenantId: account.tenantId, whatsAppAccountId: account.id };
      return cached;
    }
    throw err;
  }
}

export async function getWhatsAppAccountByPhoneNumberId(
  phoneNumberId: string,
): Promise<WhatsAppAccount | null> {
  return prisma.whatsAppAccount.findUnique({ where: { phoneNumberId } });
}
