import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

/**
 * SQLite pragmas applied on every new connection the pool opens.
 *
 * - `foreign_keys = ON`: SQLite ignores FK constraints unless explicitly
 *   enabled per-connection; without this, referential integrity in
 *   schema.prisma would be decorative only.
 * - `journal_mode = WAL`: lets readers proceed while a writer holds the
 *   write lock, which is what makes "moderate concurrency" viable at all on
 *   SQLite. Persists in the database file after the first run.
 * - `busy_timeout`: instead of failing immediately with `SQLITE_BUSY` when
 *   another connection holds the write lock, wait up to this many ms. This
 *   is the main defense against `database is locked` under bursts.
 * - `synchronous = NORMAL`: safe (no corruption risk) under WAL mode and
 *   noticeably faster than the FULL default, since WAL's own checkpointing
 *   already protects consistency.
 */
const PRAGMAS = [
  "PRAGMA foreign_keys = ON;",
  "PRAGMA journal_mode = WAL;",
  `PRAGMA busy_timeout = ${env.DATABASE_BUSY_TIMEOUT_MS};`,
  "PRAGMA synchronous = NORMAL;",
] as const;

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: env.NODE_ENV === "production" ? ["error", "warn"] : ["warn", "error"],
  });

  // $queryRawUnsafe (not $executeRawUnsafe) here is safe: PRAGMAS is a fixed,
  // hardcoded array with no user input, not a query built from request data.
  // `$executeRawUnsafe` is the wrong call for these — `PRAGMA journal_mode = WAL`
  // returns a confirmation row, which Prisma's execute (row-count-only) path
  // rejects with "Execute returned results, which is not allowed in SQLite"
  // even though the pragma applies successfully. Applied sequentially, NOT
  // inside a $transaction: SQLite also refuses to change into WAL mode while
  // a transaction is open.
  void (async () => {
    try {
      for (const pragma of PRAGMAS) {
        await client.$queryRawUnsafe(pragma);
      }
      logger.debug("SQLite pragmas applied");
    } catch (err) {
      logger.error({ err }, "Failed to apply SQLite pragmas");
    }
  })();

  return client;
}

declare global {
  var __prisma: PrismaClient | undefined;
}

/**
 * Singleton Prisma Client. Reused across `tsx watch` hot reloads in
 * development (each reload would otherwise open a fresh connection pool and
 * leak SQLite file handles) via a global stash, exactly like the
 * upstream-recommended pattern for Next.js/tsx dev servers.
 */
export const prisma: PrismaClient = globalThis.__prisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}

let shuttingDown = false;

export async function disconnectPrisma(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await prisma.$disconnect();
}
