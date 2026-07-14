import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Either the top-level Prisma Client or an active `$transaction` callback
 * client. Service functions accept this so the orchestrator can compose
 * several of them into a single short transaction (see
 * `inbound-message-processor.service.ts`), while still being callable
 * standalone (e.g. from the seed script or tests) by passing `prisma`
 * directly.
 */
export type Db = PrismaClient | Prisma.TransactionClient;
