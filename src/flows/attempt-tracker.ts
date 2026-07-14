interface WithAttempts {
  invalidAttemptCount?: number | undefined;
  lastValidationError?: string | undefined;
}

export interface RecordAttemptResult<TContext> {
  exceeded: boolean;
  context: TContext;
}

/** Increments the invalid-attempt counter kept on the flow context and reports whether the per-step limit has been reached. */
export function recordInvalidAttempt<TContext extends WithAttempts>(
  context: TContext,
  error: string,
  maxAttempts: number,
): RecordAttemptResult<TContext> {
  const invalidAttemptCount = (context.invalidAttemptCount ?? 0) + 1;
  return {
    exceeded: invalidAttemptCount >= maxAttempts,
    context: { ...context, invalidAttemptCount, lastValidationError: error },
  };
}

/** Resets the invalid-attempt counter after a step is successfully completed. */
export function clearInvalidAttempts<TContext extends WithAttempts>(context: TContext): TContext {
  const next = { ...context };
  delete next.invalidAttemptCount;
  delete next.lastValidationError;
  return next;
}
