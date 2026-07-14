import { describe, expect, it } from "vitest";
import { prisma } from "../src/infrastructure/prisma.js";
import { createFixture } from "./helpers/fixtures.js";
import {
  acquireSessionLock,
  cancelSession,
  expireSession,
  getActiveSession,
  getSessionById,
  releaseSessionLock,
  startSession,
  transitionSession,
  typedContext,
} from "../src/services/session.service.js";
import {
  ActiveSessionConflictError,
  SessionLockedError,
  SessionRevisionConflictError,
} from "../src/domain/errors.js";

async function startMenuSession(conversationId: string, tenantId: string, ttlMinutes = 15) {
  return prisma.$transaction((tx) =>
    startSession(tx, {
      tenantId,
      conversationId,
      flowType: "MAIN_MENU",
      initialStep: "SELECT_OPTION",
      ttlMinutes,
      now: new Date(),
    }),
  );
}

describe("session lifecycle", () => {
  it("creates a session with revision 0 and an ACTIVE status", async () => {
    const { tenant, conversation } = await createFixture();
    const session = await startMenuSession(conversation.id, tenant.id);

    expect(session.revision).toBe(0);
    expect(session.status).toBe("ACTIVE");
    expect(session.currentStep).toBe("SELECT_OPTION");
  });

  it("rejects a second active session for the same conversation", async () => {
    const { tenant, conversation } = await createFixture();
    await startMenuSession(conversation.id, tenant.id);

    await expect(
      prisma.$transaction((tx) =>
        startSession(tx, {
          tenantId: tenant.id,
          conversationId: conversation.id,
          flowType: "MAIN_MENU",
          initialStep: "SELECT_OPTION",
          ttlMinutes: 15,
          now: new Date(),
        }),
      ),
    ).rejects.toThrow(ActiveSessionConflictError);
  });

  it("persists the flow context across a fresh read (resumability)", async () => {
    const { tenant, conversation } = await createFixture();
    const session = await startMenuSession(conversation.id, tenant.id);

    await transitionSession(prisma, {
      sessionId: session.id,
      expectedRevision: session.revision,
      flowType: "MAIN_MENU",
      toStatus: "WAITING_INPUT",
      toStep: "SELECT_OPTION",
      context: { selectedOption: "CREATE_INVOICE", invalidAttemptCount: 2 },
      trigger: "VALIDATION_FAILURE",
      expiresAt: session.expiresAt,
      now: new Date(),
    });

    const resumed = await getSessionById(prisma, session.id);
    const context = typedContext(resumed);
    expect(context.selectedOption).toBe("CREATE_INVOICE");
    expect(context.invalidAttemptCount).toBe(2);
  });

  it("expires a session, and an expired session is no longer the active one", async () => {
    const { tenant, conversation } = await createFixture();
    const session = await startMenuSession(conversation.id, tenant.id);

    await expireSession(prisma, session, new Date());

    const active = await getActiveSession(prisma, conversation.id);
    expect(active).toBeNull();

    const stored = await getSessionById(prisma, session.id);
    expect(stored.status).toBe("EXPIRED");
    // context/history preserved
    expect(stored.context).toBe(session.context);
  });

  it("a completed session is not reused as the active session", async () => {
    const { tenant, conversation } = await createFixture();
    const session = await startMenuSession(conversation.id, tenant.id);

    await transitionSession(prisma, {
      sessionId: session.id,
      expectedRevision: session.revision,
      flowType: "MAIN_MENU",
      toStatus: "COMPLETED",
      toStep: "DONE",
      context: {},
      trigger: "VALIDATION_SUCCESS",
      expiresAt: session.expiresAt,
      now: new Date(),
      completedAt: new Date(),
    });

    const active = await getActiveSession(prisma, conversation.id);
    expect(active).toBeNull();
  });

  it("cancels a session and records the reason", async () => {
    const { tenant, conversation } = await createFixture();
    const session = await startMenuSession(conversation.id, tenant.id);

    const cancelled = await cancelSession(prisma, session, "user requested cancel", new Date());
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.failureReason).toBe("user requested cancel");
    expect(cancelled.cancelledAt).not.toBeNull();
  });

  it("restart (cancel + start new) leaves exactly one active session", async () => {
    const { tenant, conversation } = await createFixture();
    const session = await startMenuSession(conversation.id, tenant.id);

    const restarted = await prisma.$transaction(async (tx) => {
      await cancelSession(tx, session, "restart", new Date());
      return startSession(tx, {
        tenantId: tenant.id,
        conversationId: conversation.id,
        flowType: "MAIN_MENU",
        initialStep: "SELECT_OPTION",
        ttlMinutes: 15,
        now: new Date(),
      });
    });

    const active = await getActiveSession(prisma, conversation.id);
    expect(active?.id).toBe(restarted.id);
  });

  it("records a full transition history, not just the current state", async () => {
    const { tenant, conversation } = await createFixture();
    const session = await startMenuSession(conversation.id, tenant.id);

    await transitionSession(prisma, {
      sessionId: session.id,
      expectedRevision: 0,
      flowType: "MAIN_MENU",
      toStatus: "WAITING_INPUT",
      toStep: "SELECT_OPTION",
      context: {},
      trigger: "VALIDATION_FAILURE",
      expiresAt: session.expiresAt,
      now: new Date(),
    });
    await transitionSession(prisma, {
      sessionId: session.id,
      expectedRevision: 1,
      flowType: "MAIN_MENU",
      toStatus: "COMPLETED",
      toStep: "DONE",
      context: {},
      trigger: "VALIDATION_SUCCESS",
      expiresAt: session.expiresAt,
      now: new Date(),
      completedAt: new Date(),
    });

    const transitions = await prisma.sessionTransition.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });
    // 1 for creation + 2 explicit transitions above
    expect(transitions.length).toBe(3);
    expect(transitions.map((t) => t.toStatus)).toEqual(["ACTIVE", "WAITING_INPUT", "COMPLETED"]);
  });

  it("optimistic concurrency: a stale revision is rejected", async () => {
    const { tenant, conversation } = await createFixture();
    const session = await startMenuSession(conversation.id, tenant.id);

    await transitionSession(prisma, {
      sessionId: session.id,
      expectedRevision: 0,
      flowType: "MAIN_MENU",
      toStatus: "WAITING_INPUT",
      toStep: "SELECT_OPTION",
      context: {},
      trigger: "VALIDATION_FAILURE",
      expiresAt: session.expiresAt,
      now: new Date(),
    });

    // Reusing revision 0 again must fail — someone (the call above) already moved it to revision 1.
    await expect(
      transitionSession(prisma, {
        sessionId: session.id,
        expectedRevision: 0,
        flowType: "MAIN_MENU",
        toStatus: "COMPLETED",
        toStep: "DONE",
        context: {},
        trigger: "VALIDATION_SUCCESS",
        expiresAt: session.expiresAt,
        now: new Date(),
      }),
    ).rejects.toThrow(SessionRevisionConflictError);
  });

  it("a live lock cannot be acquired by a different worker", async () => {
    const { tenant, conversation } = await createFixture();
    const session = await startMenuSession(conversation.id, tenant.id);
    const now = new Date();

    await acquireSessionLock(prisma, session.id, "worker-a", 30, now);

    await expect(acquireSessionLock(prisma, session.id, "worker-b", 30, now)).rejects.toThrow(
      SessionLockedError,
    );
  });

  it("an expired lock can be recovered by another worker", async () => {
    const { tenant, conversation } = await createFixture();
    const session = await startMenuSession(conversation.id, tenant.id);
    const past = new Date(Date.now() - 60_000);

    // Simulate a crashed worker: lock granted in the past, already expired.
    await acquireSessionLock(prisma, session.id, "worker-a", -30, past);

    const recovered = await acquireSessionLock(prisma, session.id, "worker-b", 30, new Date());
    expect(recovered.lockedBy).toBe("worker-b");
  });

  it("release only clears the lock if still held by the same worker", async () => {
    const { tenant, conversation } = await createFixture();
    const session = await startMenuSession(conversation.id, tenant.id);
    const now = new Date();

    await acquireSessionLock(prisma, session.id, "worker-a", 30, now);
    await releaseSessionLock(prisma, session.id, "worker-b"); // no-op, not the holder

    const stillLocked = await getSessionById(prisma, session.id);
    expect(stillLocked.lockedBy).toBe("worker-a");

    await releaseSessionLock(prisma, session.id, "worker-a");
    const released = await getSessionById(prisma, session.id);
    expect(released.lockedBy).toBeNull();
  });
});
