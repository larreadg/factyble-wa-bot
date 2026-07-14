/**
 * In-process mutex keyed by a partition key (WhatsApp account + sender wa_id
 * — stable and known before any DB lookup, so it also serializes the very
 * first message from a brand-new contact, before a Conversation row exists).
 *
 * This is the fast path for "messages from the same conversation are
 * processed in order, never in parallel" within a single Node process. It is
 * NOT a substitute for the DB-level session lock
 * (`acquireSessionLock`/`releaseSessionLock` in session.service.ts) — that
 * one is the cross-process guarantee that survives a second instance of this
 * process running concurrently, or this in-memory queue being wiped by a
 * restart mid-flight. Together: the in-memory queue avoids wasted
 * lock-contention retries in the common case, the DB lock is what actually
 * has to hold for correctness.
 */
const tails = new Map<string, Promise<unknown>>();

export function conversationPartitionKey(whatsAppAccountId: string, waId: string): string {
  return `${whatsAppAccountId}:${waId}`;
}

export function runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previousTail = tails.get(key) ?? Promise.resolve();
  const result = previousTail.then(task, task);

  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, settled);
  void settled.finally(() => {
    if (tails.get(key) === settled) tails.delete(key);
  });

  return result;
}
