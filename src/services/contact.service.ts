import type { Contact } from "@prisma/client";
import type { Db } from "../infrastructure/db.js";
import { isUniqueConstraintError } from "../utils/prisma-errors.js";

export interface GetOrCreateContactInput {
  tenantId: string;
  waId: string;
  phoneNumber: string;
  profileName?: string;
  now: Date;
}

/** One Contact per (tenantId, waId), never duplicated per conversation. */
export async function getOrCreateContact(db: Db, input: GetOrCreateContactInput): Promise<Contact> {
  const existing = await db.contact.findUnique({
    where: { tenantId_waId: { tenantId: input.tenantId, waId: input.waId } },
  });

  if (existing) {
    return db.contact.update({
      where: { id: existing.id },
      data: {
        lastSeenAt: input.now,
        ...(input.profileName && input.profileName !== existing.profileName
          ? { profileName: input.profileName }
          : {}),
      },
    });
  }

  try {
    return await db.contact.create({
      data: {
        tenantId: input.tenantId,
        waId: input.waId,
        phoneNumber: input.phoneNumber,
        lastSeenAt: input.now,
        ...(input.profileName ? { profileName: input.profileName } : {}),
      },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return db.contact.findUniqueOrThrow({
        where: { tenantId_waId: { tenantId: input.tenantId, waId: input.waId } },
      });
    }
    throw err;
  }
}
