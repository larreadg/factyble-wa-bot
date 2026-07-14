import type { AuditActorType } from "@prisma/client";
import type { Db } from "../infrastructure/db.js";
import { sanitizeForAudit } from "../utils/sanitize.js";

export interface RecordAuditLogInput {
  tenantId: string;
  actorType: AuditActorType;
  actorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  requestId?: string;
  correlationId?: string;
  beforeData?: unknown;
  afterData?: unknown;
  metadata?: unknown;
}

/** Never pass raw request/response bodies here without going through `sanitizeForAudit` first — this wraps it, but callers must not bypass by pre-stringifying. */
export async function recordAuditLog(db: Db, input: RecordAuditLogInput): Promise<void> {
  await db.auditLog.create({
    data: {
      tenantId: input.tenantId,
      actorType: input.actorType,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      ...(input.actorId ? { actorId: input.actorId } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      ...(input.beforeData !== undefined
        ? { beforeData: JSON.stringify(sanitizeForAudit(input.beforeData)) }
        : {}),
      ...(input.afterData !== undefined
        ? { afterData: JSON.stringify(sanitizeForAudit(input.afterData)) }
        : {}),
      ...(input.metadata !== undefined
        ? { metadata: JSON.stringify(sanitizeForAudit(input.metadata)) }
        : {}),
    },
  });
}
