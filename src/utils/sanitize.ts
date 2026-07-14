const SENSITIVE_KEY_PATTERN = /token|secret|password|authorization|api[-_]?key|access[-_]?key/i;

/**
 * Deep-clones a value, replacing any object key that looks like a credential
 * with `"[REDACTED]"`. Used before persisting request/response payloads or
 * audit metadata — nothing sensitive should ever reach the database.
 */
export function sanitizeForAudit(value: unknown, depth = 0): unknown {
  if (depth > 10) return "[TRUNCATED]";

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForAudit(item, depth + 1));
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? "[REDACTED]"
        : sanitizeForAudit(val, depth + 1);
    }
    return result;
  }

  return value;
}
