import { prisma } from "../infrastructure/prisma.js";
import { logger } from "../utils/logger.js";
import { expireSession } from "./session.service.js";

const ACTIVE_STATUSES = [
  "ACTIVE",
  "WAITING_INPUT",
  "VALIDATING",
  "WAITING_EXTERNAL_SERVICE",
] as const;
const REAP_INTERVAL_MS = 60_000;
const BATCH_SIZE = 50;

/**
 * Background hygiene: an abandoned conversation (the user never sends
 * another message) would otherwise sit in an active status forever, since
 * expiry is normally discovered lazily when the next message arrives (see
 * `inbound-message-processor.service.ts`). This periodically finds sessions
 * past `expiresAt` and marks them EXPIRED, preserving context/history per
 * the acceptance criteria. No message is sent to the user — there is
 * nothing to react to a message that never comes.
 */
async function reapExpiredSessions(): Promise<void> {
  const now = new Date();
  const candidates = await prisma.conversationSession.findMany({
    where: { status: { in: [...ACTIVE_STATUSES] }, expiresAt: { lte: now } },
    take: BATCH_SIZE,
  });

  for (const session of candidates) {
    try {
      await expireSession(prisma, session, now);
    } catch (err) {
      // A revision conflict here just means a real message beat the reaper to it — not an error worth logging loudly.
      logger.debug(
        { err, sessionId: session.id },
        "Skipped reaping session (already transitioned)",
      );
    }
  }

  if (candidates.length > 0) {
    logger.info({ count: candidates.length }, "Reaped expired sessions");
  }
}

export function startSessionReaper(): () => void {
  let stopped = false;

  const loop = (): void => {
    if (stopped) return;
    reapExpiredSessions()
      .catch((err: unknown) => logger.error({ err }, "Session reaper tick failed"))
      .finally(() => {
        if (!stopped) setTimeout(loop, REAP_INTERVAL_MS);
      });
  };

  loop();

  return () => {
    stopped = true;
  };
}
