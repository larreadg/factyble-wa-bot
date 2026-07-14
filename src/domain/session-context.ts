import { z } from "zod";
import type { FlowType } from "@prisma/client";
import { DomainError } from "./errors.js";

/**
 * `ConversationSession.context` is stored as a serialized string, not
 * Prisma's `Json` scalar. SQLite's `Json` support in Prisma stores the exact
 * same TEXT column under the hood but types the field as `Prisma.JsonValue`
 * (effectively `any`), which invites unchecked casts. Storing it as `String`
 * and always going through this codec — which validates with Zod before
 * anything is treated as a typed context — makes unsafe casts structurally
 * impossible: there is no other way to get a `CreateInvoiceSessionContext`
 * out of the database.
 */

export class ContextValidationError extends DomainError {
  constructor(flowType: string, issues: string) {
    super(`Invalid session context for flow ${flowType}: ${issues}`, "CONTEXT_VALIDATION_ERROR");
  }
}

// ---------------------------------------------------------------------------
// Shared fields
// ---------------------------------------------------------------------------

const baseContextSchema = z.object({
  invalidAttemptCount: z.number().int().min(0).optional(),
  lastValidationError: z.string().optional(),
  handoffRequested: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Per-flow contexts
// ---------------------------------------------------------------------------

const mainMenuContextSchema = baseContextSchema.extend({
  selectedOption: z.string().optional(),
});
export type MainMenuSessionContext = z.infer<typeof mainMenuContextSchema>;

const invoiceItemSchema = z.object({
  quantity: z.string(),
  description: z.string(),
  unitPrice: z.string(),
});
export type InvoiceItemDraft = z.infer<typeof invoiceItemSchema>;

const createInvoiceContextSchema = baseContextSchema.extend({
  customer: z
    .object({
      taxId: z.string().optional(),
      name: z.string().optional(),
      email: z.string().optional(),
    })
    .optional(),
  items: z.array(invoiceItemSchema).optional(),
  currentItemDraft: z
    .object({
      quantity: z.string().optional(),
      description: z.string().optional(),
      unitPrice: z.string().optional(),
    })
    .optional(),
  confirmationPending: z.boolean().optional(),
  externalRequestId: z.string().optional(),
  externalInvoiceId: z.string().optional(),
});
export type CreateInvoiceSessionContext = z.infer<typeof createInvoiceContextSchema>;

const queryInvoiceContextSchema = baseContextSchema.extend({
  searchCriteria: z.enum(["CDC", "INVOICE_NUMBER", "TAX_ID", "EXTERNAL_ID"]).optional(),
  searchValue: z.string().optional(),
  externalRequestId: z.string().optional(),
});
export type QueryInvoiceSessionContext = z.infer<typeof queryInvoiceContextSchema>;

const createCreditNoteContextSchema = baseContextSchema.extend({
  originalInvoiceRef: z.string().optional(),
  reason: z.string().optional(),
  affectationType: z.string().optional(),
  items: z.array(invoiceItemSchema).optional(),
  currentItemDraft: z
    .object({
      quantity: z.string().optional(),
      description: z.string().optional(),
      unitPrice: z.string().optional(),
    })
    .optional(),
  confirmationPending: z.boolean().optional(),
  externalRequestId: z.string().optional(),
  externalCreditNoteId: z.string().optional(),
});
export type CreateCreditNoteSessionContext = z.infer<typeof createCreditNoteContextSchema>;

const queryCreditNoteContextSchema = baseContextSchema.extend({
  searchCriteria: z
    .enum(["CDC", "CREDIT_NOTE_NUMBER", "RELATED_INVOICE", "EXTERNAL_ID"])
    .optional(),
  searchValue: z.string().optional(),
  externalRequestId: z.string().optional(),
});
export type QueryCreditNoteSessionContext = z.infer<typeof queryCreditNoteContextSchema>;

export interface FlowContextMap {
  MAIN_MENU: MainMenuSessionContext;
  CREATE_INVOICE: CreateInvoiceSessionContext;
  QUERY_INVOICE: QueryInvoiceSessionContext;
  CREATE_CREDIT_NOTE: CreateCreditNoteSessionContext;
  QUERY_CREDIT_NOTE: QueryCreditNoteSessionContext;
}

const schemaByFlowType = {
  MAIN_MENU: mainMenuContextSchema,
  CREATE_INVOICE: createInvoiceContextSchema,
  QUERY_INVOICE: queryInvoiceContextSchema,
  CREATE_CREDIT_NOTE: createCreditNoteContextSchema,
  QUERY_CREDIT_NOTE: queryCreditNoteContextSchema,
} satisfies { [K in FlowType]: z.ZodType<FlowContextMap[K]> };

/** Current context schema version per flow. Bump when the shape changes and add a migration below. */
export const CURRENT_CONTEXT_VERSION: { [K in FlowType]: number } = {
  MAIN_MENU: 1,
  CREATE_INVOICE: 1,
  QUERY_INVOICE: 1,
  CREATE_CREDIT_NOTE: 1,
  QUERY_CREDIT_NOTE: 1,
};

/**
 * Migrations from version N to N+1, keyed by flow type. `migrations[i]`
 * transforms version `i + 1` into version `i + 2`. Empty today (everything
 * is at version 1) — add an entry here instead of ever changing the meaning
 * of an existing version number.
 */
const contextMigrations: { [K in FlowType]: Array<(data: unknown) => unknown> } = {
  MAIN_MENU: [],
  CREATE_INVOICE: [],
  QUERY_INVOICE: [],
  CREATE_CREDIT_NOTE: [],
  QUERY_CREDIT_NOTE: [],
};

const envelopeSchema = z.object({
  version: z.number().int().positive(),
  data: z.unknown(),
});

/** Serializes a validated flow context into the string stored in `ConversationSession.context`. */
export function serializeContext<T extends FlowType>(flowType: T, data: FlowContextMap[T]): string {
  const schema = schemaByFlowType[flowType];
  const validated = schema.parse(data);
  return JSON.stringify({ version: CURRENT_CONTEXT_VERSION[flowType], data: validated });
}

/**
 * Deserializes and validates a stored context string. Applies any pending
 * migrations first, then validates against the current schema for that flow
 * type — this is the only place a `context` column value is ever trusted.
 *
 * The final `as FlowContextMap[T]` is sound, not a bare cast: `result.data`
 * was just produced by `schemaByFlowType[flowType].safeParse`, and
 * `schemaByFlowType` is statically typed as `{ [K in FlowType]: ZodType<FlowContextMap[K]> }`,
 * so the runtime-validated shape and the compile-time type are guaranteed to
 * match for the same `flowType` key.
 */
export function deserializeContext<T extends FlowType>(
  flowType: T,
  raw: string,
): FlowContextMap[T] {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new ContextValidationError(flowType, "stored context is not valid JSON");
  }

  const envelope = envelopeSchema.safeParse(parsedJson);
  if (!envelope.success) {
    throw new ContextValidationError(flowType, "stored context envelope is malformed");
  }

  let data = envelope.data.data;
  const migrations = contextMigrations[flowType];
  for (
    let version = envelope.data.version;
    version < CURRENT_CONTEXT_VERSION[flowType];
    version++
  ) {
    const migrate = migrations[version - 1];
    if (!migrate) {
      throw new ContextValidationError(flowType, `no migration registered from version ${version}`);
    }
    data = migrate(data);
  }

  const schema = schemaByFlowType[flowType];
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ContextValidationError(flowType, result.error.message);
  }

  return result.data as FlowContextMap[T];
}

/** Builds the initial (empty) context envelope for a freshly started session. */
export function createInitialContext<T extends FlowType>(flowType: T): string {
  const schema = schemaByFlowType[flowType];
  const empty = schema.parse({});
  return JSON.stringify({ version: CURRENT_CONTEXT_VERSION[flowType], data: empty });
}
