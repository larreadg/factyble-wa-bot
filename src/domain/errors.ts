/**
 * Internal domain errors for the conversation engine.
 *
 * These are distinct from `utils/errors.ts` `AppError` family: `AppError` is
 * an HTTP-boundary concept (it carries a `statusCode` and is serialized by
 * `error-handler.middleware.ts`). Domain errors are thrown deep inside
 * services, caught by the pipeline orchestrator, and logged/retried — they
 * are never meant to reach Express's error middleware, since the webhook
 * controller acknowledges Meta before any of this code runs (see
 * webhook.controller.ts). Keeping them separate stops HTTP concerns leaking
 * into the domain layer.
 */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ConversationNotFoundError extends DomainError {
  constructor(conversationId: string) {
    super(`Conversation not found: ${conversationId}`, "CONVERSATION_NOT_FOUND");
  }
}

export class SessionNotFoundError extends DomainError {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`, "SESSION_NOT_FOUND");
  }
}

export class ActiveSessionConflictError extends DomainError {
  constructor(conversationId: string, existingSessionId: string) {
    super(
      `Conversation ${conversationId} already has an active session (${existingSessionId})`,
      "ACTIVE_SESSION_CONFLICT",
    );
  }
}

export class SessionExpiredError extends DomainError {
  constructor(sessionId: string) {
    super(`Session expired: ${sessionId}`, "SESSION_EXPIRED");
  }
}

export class SessionLockedError extends DomainError {
  constructor(sessionId: string, lockedBy: string) {
    super(`Session ${sessionId} is locked by ${lockedBy}`, "SESSION_LOCKED");
  }
}

export class SessionRevisionConflictError extends DomainError {
  constructor(sessionId: string, expectedRevision: number, actualRevision: number) {
    super(
      `Session ${sessionId} revision conflict: expected ${expectedRevision}, found ${actualRevision}`,
      "SESSION_REVISION_CONFLICT",
    );
  }
}

export class InvalidSessionTransitionError extends DomainError {
  constructor(sessionId: string, fromStatus: string, toStatus: string) {
    super(
      `Session ${sessionId} cannot transition from ${fromStatus} to ${toStatus}`,
      "INVALID_SESSION_TRANSITION",
    );
  }
}

export class DuplicateMessageError extends DomainError {
  constructor(providerMessageId: string) {
    super(`Message already processed: ${providerMessageId}`, "DUPLICATE_MESSAGE");
  }
}

export class DuplicateWebhookError extends DomainError {
  constructor(payloadHash: string) {
    super(`Webhook already processed: ${payloadHash}`, "DUPLICATE_WEBHOOK");
  }
}

export class IdempotencyConflictError extends DomainError {
  constructor(scope: string, key: string) {
    super(
      `Idempotency key reused with a different payload: scope=${scope} key=${key}`,
      "IDEMPOTENCY_CONFLICT",
    );
  }
}

export class ExternalServiceUnavailableError extends DomainError {
  constructor(operation: string, message: string) {
    super(
      `External service unavailable for ${operation}: ${message}`,
      "EXTERNAL_SERVICE_UNAVAILABLE",
    );
  }
}

export class ExternalServiceTimeoutError extends DomainError {
  constructor(operation: string, timeoutMs: number) {
    super(
      `External service timed out for ${operation} after ${timeoutMs}ms`,
      "EXTERNAL_SERVICE_TIMEOUT",
    );
  }
}

/**
 * Thrown when a call to the billing backend fails in a way that does not
 * tell us whether the operation actually took effect (e.g. a timeout, or a
 * connection reset after the request was sent). Callers must NOT
 * automatically retry the mutating operation — they must reconcile first
 * (query by idempotencyKey/correlationId) per ExternalServiceRequest.status
 * `UNKNOWN`.
 */
export class ExternalOperationUncertainError extends DomainError {
  constructor(operation: string, idempotencyKey: string) {
    super(
      `External operation ${operation} (idempotencyKey=${idempotencyKey}) is in an uncertain state and must be reconciled before retrying`,
      "EXTERNAL_OPERATION_UNCERTAIN",
    );
  }
}

export class DatabaseBusyError extends DomainError {
  constructor(message = "Database is busy") {
    super(message, "DATABASE_BUSY");
  }
}
