import { z } from "zod";

/**
 * Runtime validation for `ExternalServiceRequest.requestPayload` once it
 * comes back out of the database as `unknown` JSON. The payload is produced
 * by our own flow code (see `ExternalCallDraft.requestPayload` in each
 * flow's confirmation step), so this mostly guards against schema drift
 * between a flow and the billing client — but per CLAUDE.md, nothing gets
 * cast to a client input type without going through a schema first.
 */

const itemSchema = z.object({
  quantity: z.string(),
  description: z.string(),
  unitPrice: z.string(),
});

export const createInvoicePayloadSchema = z.object({
  customer: z.object({
    taxId: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
  }),
  items: z.array(itemSchema).min(1),
});

export const queryInvoicePayloadSchema = z.object({
  criteria: z.string().optional(),
  value: z.string().optional(),
});

export const createCreditNotePayloadSchema = z.object({
  originalInvoiceRef: z.string().optional(),
  reason: z.string().optional(),
  affectationType: z.string().optional(),
  items: z.array(itemSchema).optional(),
});

export const queryCreditNotePayloadSchema = z.object({
  criteria: z.string().optional(),
  value: z.string().optional(),
});
