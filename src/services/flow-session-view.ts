import type { ConversationSession, FlowType } from "@prisma/client";
import type { FlowSessionView } from "../domain/flow.js";
import type { FlowContextMap } from "../domain/session-context.js";
import { typedContext } from "./session.service.js";

/** Structurally safe: every entry in FlowContextMap extends the shared base context schema, which always declares `invalidAttemptCount` as optional. */
function readInvalidAttemptCount(context: unknown): number {
  const value = (context as { invalidAttemptCount?: number }).invalidAttemptCount;
  return value ?? 0;
}

export function toFlowSessionView<T extends FlowType>(
  session: ConversationSession & { flowType: T },
): FlowSessionView<FlowContextMap[T]> {
  const context = typedContext(session);
  return {
    id: session.id,
    tenantId: session.tenantId,
    conversationId: session.conversationId,
    flowType: session.flowType,
    flowVersion: session.flowVersion,
    currentStep: session.currentStep,
    status: session.status,
    context,
    revision: session.revision,
    invalidAttemptCount: readInvalidAttemptCount(context),
  };
}
