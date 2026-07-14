import type { Conversation } from "@prisma/client";
import type { Db } from "../infrastructure/db.js";
import { ConversationNotFoundError } from "../domain/errors.js";

export interface GetOrCreateConversationInput {
  tenantId: string;
  whatsAppAccountId: string;
  contactId: string;
  now: Date;
}

/** The most recent non-closed conversation for the contact, or a fresh OPEN one. */
export async function getOrCreateConversation(
  db: Db,
  input: GetOrCreateConversationInput,
): Promise<Conversation> {
  const existing = await db.conversation.findFirst({
    where: {
      tenantId: input.tenantId,
      contactId: input.contactId,
      status: { notIn: ["CLOSED", "ARCHIVED"] },
    },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    return db.conversation.update({
      where: { id: existing.id },
      data: { lastMessageAt: input.now },
    });
  }

  return db.conversation.create({
    data: {
      tenantId: input.tenantId,
      whatsAppAccountId: input.whatsAppAccountId,
      contactId: input.contactId,
      status: "OPEN",
      startedAt: input.now,
      lastMessageAt: input.now,
    },
  });
}

export async function getConversationById(db: Db, conversationId: string): Promise<Conversation> {
  const conversation = await db.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation) throw new ConversationNotFoundError(conversationId);
  return conversation;
}
