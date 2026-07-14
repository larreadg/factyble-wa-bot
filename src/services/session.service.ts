import type {
  ConversationSession,
  FlowType,
  SessionStatus,
  TransitionTrigger,
} from "@prisma/client";
import type { Db } from "../infrastructure/db.js";
import {
  ActiveSessionConflictError,
  SessionLockedError,
  SessionNotFoundError,
  SessionRevisionConflictError,
} from "../domain/errors.js";
import {
  createInitialContext,
  deserializeContext,
  serializeContext,
  type FlowContextMap,
} from "../domain/session-context.js";
import { sanitizeForAudit } from "../utils/sanitize.js";
import { addSeconds } from "../utils/date.js";

const ACTIVE_STATUSES: SessionStatus[] = [
  "ACTIVE",
  "WAITING_INPUT",
  "VALIDATING",
  "WAITING_EXTERNAL_SERVICE",
];

export function isActiveStatus(status: SessionStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

/** The single active session for a conversation, if any. There is at most one by construction (see startSession). */
export async function getActiveSession(
  db: Db,
  conversationId: string,
): Promise<ConversationSession | null> {
  return db.conversationSession.findFirst({
    where: { conversationId, status: { in: ACTIVE_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getSessionById(db: Db, sessionId: string): Promise<ConversationSession> {
  const session = await db.conversationSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new SessionNotFoundError(sessionId);
  return session;
}

export interface StartSessionInput<T extends FlowType> {
  tenantId: string;
  conversationId: string;
  flowType: T;
  initialStep: string;
  ttlMinutes: number;
  now: Date;
}

/**
 * Creates the session for a flow. MUST be called inside a transaction (the
 * caller's `db` should be a `$transaction` client): the check for an
 * existing active session and the insert need to be atomic, since SQLite (and
 * any other SQL database) offers no portable partial-unique-index guarantee
 * we can lean on alone — see the migration note in
 * `prisma/migrations/*_add_active_session_partial_index/migration.sql`.
 */
export async function startSession<T extends FlowType>(
  db: Db,
  input: StartSessionInput<T>,
): Promise<ConversationSession> {
  const existing = await getActiveSession(db, input.conversationId);
  if (existing) {
    throw new ActiveSessionConflictError(input.conversationId, existing.id);
  }

  const expiresAt = addSeconds(input.now, input.ttlMinutes * 60);
  const context = createInitialContext(input.flowType);

  const session = await db.conversationSession.create({
    data: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      flowType: input.flowType,
      currentStep: input.initialStep,
      status: "ACTIVE",
      context,
      expiresAt,
      startedAt: input.now,
      lastActivityAt: input.now,
    },
  });

  await db.sessionTransition.create({
    data: {
      sessionId: session.id,
      toStatus: session.status,
      toStep: session.currentStep,
      trigger: "SYSTEM_EVENT",
    },
  });

  return session;
}

/**
 * Acquires (or recovers) the logical lock on a session for exclusive local
 * processing. Recovers automatically if the previous holder's lock expired
 * (crash/timeout) — see docs/conversation-architecture.md "Bloqueos". Should
 * be called OUTSIDE the main processing transaction and released before any
 * external I/O (WhatsApp/billing backend).
 */
export async function acquireSessionLock(
  db: Db,
  sessionId: string,
  workerId: string,
  lockTtlSeconds: number,
  now: Date,
): Promise<ConversationSession> {
  const session = await getSessionById(db, sessionId);

  const lockIsLive = session.lockExpiresAt !== null && session.lockExpiresAt > now;
  if (lockIsLive && session.lockedBy !== workerId) {
    throw new SessionLockedError(sessionId, session.lockedBy ?? "unknown");
  }

  const lockExpiresAt = addSeconds(now, lockTtlSeconds);
  const claimed = await db.conversationSession.updateMany({
    where: {
      id: sessionId,
      OR: [{ lockExpiresAt: null }, { lockExpiresAt: { lte: now } }, { lockedBy: workerId }],
    },
    data: { lockedAt: now, lockedBy: workerId, lockExpiresAt },
  });

  if (claimed.count === 0) {
    throw new SessionLockedError(sessionId, "unknown");
  }

  return getSessionById(db, sessionId);
}

/** Releases the lock only if still held by `workerId` — a no-op otherwise (already expired/stolen). */
export async function releaseSessionLock(
  db: Db,
  sessionId: string,
  workerId: string,
): Promise<void> {
  await db.conversationSession.updateMany({
    where: { id: sessionId, lockedBy: workerId },
    data: { lockedAt: null, lockedBy: null, lockExpiresAt: null },
  });
}

export interface TransitionSessionInput<T extends FlowType> {
  sessionId: string;
  expectedRevision: number;
  flowType: T;
  toStatus: SessionStatus;
  toStep: string;
  context: FlowContextMap[T];
  trigger: TransitionTrigger;
  expiresAt: Date;
  now: Date;
  messageId?: string;
  metadata?: Record<string, unknown>;
  completedAt?: Date;
  cancelledAt?: Date;
  failedAt?: Date;
  failureCode?: string;
  failureReason?: string;
}

/**
 * The core optimistic-concurrency write. `revision` must match exactly, or
 * this throws `SessionRevisionConflictError` instead of silently
 * overwriting a concurrent change (see conditional `updateMany` — an
 * `update` would happily clobber, which is exactly what we must not do).
 */
export async function transitionSession<T extends FlowType>(
  db: Db,
  input: TransitionSessionInput<T>,
): Promise<ConversationSession> {
  const current = await getSessionById(db, input.sessionId);
  const contextString = serializeContext(input.flowType, input.context);

  const result = await db.conversationSession.updateMany({
    where: { id: input.sessionId, revision: input.expectedRevision },
    data: {
      status: input.toStatus,
      previousStep: current.currentStep,
      currentStep: input.toStep,
      context: contextString,
      revision: { increment: 1 },
      expiresAt: input.expiresAt,
      lastActivityAt: input.now,
      ...(input.completedAt ? { completedAt: input.completedAt } : {}),
      ...(input.cancelledAt ? { cancelledAt: input.cancelledAt } : {}),
      ...(input.failedAt ? { failedAt: input.failedAt } : {}),
      ...(input.failureCode !== undefined ? { failureCode: input.failureCode } : {}),
      ...(input.failureReason !== undefined ? { failureReason: input.failureReason } : {}),
    },
  });

  if (result.count === 0) {
    throw new SessionRevisionConflictError(
      input.sessionId,
      input.expectedRevision,
      current.revision,
    );
  }

  await db.sessionTransition.create({
    data: {
      sessionId: input.sessionId,
      fromStatus: current.status,
      toStatus: input.toStatus,
      fromStep: current.currentStep,
      toStep: input.toStep,
      trigger: input.trigger,
      ...(input.messageId ? { messageId: input.messageId } : {}),
      ...(input.metadata ? { metadata: JSON.stringify(sanitizeForAudit(input.metadata)) } : {}),
    },
  });

  return getSessionById(db, input.sessionId);
}

/** Marks an expired session terminal. Context and history are preserved — see acceptance criteria. */
export async function expireSession(
  db: Db,
  session: ConversationSession,
  now: Date,
): Promise<ConversationSession> {
  const context = deserializeContext(session.flowType, session.context);
  return transitionSession(db, {
    sessionId: session.id,
    expectedRevision: session.revision,
    flowType: session.flowType,
    toStatus: "EXPIRED",
    toStep: session.currentStep,
    context,
    trigger: "TIMEOUT",
    expiresAt: session.expiresAt,
    now,
  });
}

export async function cancelSession(
  db: Db,
  session: ConversationSession,
  reason: string,
  now: Date,
): Promise<ConversationSession> {
  const context = deserializeContext(session.flowType, session.context);
  return transitionSession(db, {
    sessionId: session.id,
    expectedRevision: session.revision,
    flowType: session.flowType,
    toStatus: "CANCELLED",
    toStep: session.currentStep,
    context,
    trigger: "CANCEL_COMMAND",
    expiresAt: session.expiresAt,
    now,
    cancelledAt: now,
    failureReason: reason,
  });
}

export function typedContext<T extends FlowType>(
  session: ConversationSession & { flowType: T },
): FlowContextMap[T] {
  return deserializeContext(session.flowType, session.context);
}
