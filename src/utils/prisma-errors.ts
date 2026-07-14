import { Prisma } from "@prisma/client";

/** True for Prisma's "unique constraint failed" error (P2002) — the signal to fall back to a read in getOrCreate/idempotent-insert patterns. */
export function isUniqueConstraintError(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** True for SQLite's "database is locked"/"database is busy" errors surfaced through Prisma. */
export function isDatabaseBusyError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const message = err.message.toLowerCase();
    return message.includes("database is locked") || message.includes("database is busy");
  }
  return false;
}
