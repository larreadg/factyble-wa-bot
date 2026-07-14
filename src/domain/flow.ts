import type { ExternalOperation, FlowType, SessionStatus, TransitionTrigger } from "@prisma/client";
import type { FlowContextMap } from "./session-context.js";
import type { NormalizedInboundMessage } from "./normalized-message.js";

export interface FlowSessionView<TContext> {
  id: string;
  tenantId: string;
  conversationId: string;
  flowType: FlowType;
  flowVersion: number;
  currentStep: string;
  status: SessionStatus;
  context: TContext;
  revision: number;
  invalidAttemptCount: number;
}

export interface FlowInput<TContext> {
  session: FlowSessionView<TContext>;
  message: NormalizedInboundMessage;
  now: Date;
}

export interface OutboundMessageDraft {
  type: "text";
  text: string;
}

export interface ExternalCallDraft {
  operation: ExternalOperation;
  requestPayload: Record<string, unknown>;
}

export type FlowResultKind = "advance" | "stay" | "complete" | "cancel" | "fail" | "handoff";

export interface FlowResult<TContext> {
  kind: FlowResultKind;
  nextStep: string;
  nextStatus: SessionStatus;
  context: TContext;
  trigger: TransitionTrigger;
  outboundMessages: OutboundMessageDraft[];
  externalCall?: ExternalCallDraft;
  failureCode?: string | undefined;
  failureReason?: string | undefined;
}

/** Outcome of a completed call to the external billing backend, fed back into a flow. */
export interface ExternalCallOutcome {
  succeeded: boolean;
  externalResourceId?: string;
  responsePayload?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * A concrete, versioned conversational flow. Implementations must be pure
 * with respect to I/O: `handle`/`handleExternalResult` only ever read their
 * inputs and return a description of what should happen — they never touch
 * Prisma, WhatsApp, or the billing backend directly. The orchestrator
 * (`inbound-message-processor.service.ts`) is the only place side effects
 * happen, which is what keeps flows unit-testable and keeps external calls
 * outside of DB transactions.
 */
export interface ConversationFlow<T extends FlowType> {
  readonly type: T;
  readonly version: number;
  readonly initialStep: string;
  readonly ttlMinutes: number;

  /** Handle a user message while the session is waiting at `input.session.currentStep`. */
  handle(input: FlowInput<FlowContextMap[T]>): Promise<FlowResult<FlowContextMap[T]>>;

  /** Handle the result of the external call this flow requested via `FlowResult.externalCall`. */
  handleExternalResult(
    input: FlowInput<FlowContextMap[T]>,
    outcome: ExternalCallOutcome,
  ): Promise<FlowResult<FlowContextMap[T]>>;

  /** Contextual help text shown for the `ayuda` global command at a given step. */
  helpMessage(step: string): string;
}
