import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import {
  ExternalOperationUncertainError,
  ExternalServiceUnavailableError,
} from "../domain/errors.js";

export interface ExternalRequestOptions {
  idempotencyKey: string;
  correlationId: string;
  timeoutMs?: number;
}

export interface InvoiceItemInput {
  quantity: string;
  description: string;
  unitPrice: string;
}

export interface CreateInvoiceInput {
  customer: { taxId?: string | undefined; name?: string | undefined; email?: string | undefined };
  items: InvoiceItemInput[];
}
export interface CreateInvoiceResult {
  externalInvoiceId: string;
  raw: Record<string, unknown>;
}

export interface QueryInvoiceInput {
  criteria?: string | undefined;
  value?: string | undefined;
}
export interface QueryInvoiceResult {
  raw: Record<string, unknown>;
}

export interface CreateCreditNoteInput {
  originalInvoiceRef?: string | undefined;
  reason?: string | undefined;
  affectationType?: string | undefined;
  items?: InvoiceItemInput[] | undefined;
}
export interface CreateCreditNoteResult {
  externalCreditNoteId: string;
  raw: Record<string, unknown>;
}

export interface QueryCreditNoteInput {
  criteria?: string | undefined;
  value?: string | undefined;
}
export interface QueryCreditNoteResult {
  raw: Record<string, unknown>;
}

/**
 * Decoupled from any concrete HTTP shape so the real billing backend's API
 * can change without touching flow code (flows only ever see
 * `ExternalCallDraft.operation`/`requestPayload` — see domain/flow.ts).
 * `createInvoice`/`createCreditNote` MUST NOT be retried internally: a
 * timeout after the request left this process does not tell us whether the
 * backend applied it, so this throws `ExternalOperationUncertainError`
 * instead of retrying, leaving reconciliation to the caller (query first).
 */
export interface BillingBackendClient {
  createInvoice(
    input: CreateInvoiceInput,
    options: ExternalRequestOptions,
  ): Promise<CreateInvoiceResult>;
  queryInvoices(
    input: QueryInvoiceInput,
    options: ExternalRequestOptions,
  ): Promise<QueryInvoiceResult>;
  createCreditNote(
    input: CreateCreditNoteInput,
    options: ExternalRequestOptions,
  ): Promise<CreateCreditNoteResult>;
  queryCreditNotes(
    input: QueryCreditNoteInput,
    options: ExternalRequestOptions,
  ): Promise<QueryCreditNoteResult>;
}

interface HttpErrorBody {
  message?: string;
  code?: string;
}

class HttpBillingBackendClient implements BillingBackendClient {
  private readonly baseUrl = env.BILLING_BACKEND_BASE_URL.replace(/\/+$/, "");

  async createInvoice(
    input: CreateInvoiceInput,
    options: ExternalRequestOptions,
  ): Promise<CreateInvoiceResult> {
    const raw = await this.request("POST", "/invoices", input, options);
    const externalInvoiceId = this.extractResourceId(raw);
    if (!externalInvoiceId) {
      throw new ExternalServiceUnavailableError(
        "CREATE_INVOICE",
        "Response did not include a resource id",
      );
    }
    return { externalInvoiceId, raw };
  }

  async queryInvoices(
    input: QueryInvoiceInput,
    options: ExternalRequestOptions,
  ): Promise<QueryInvoiceResult> {
    const raw = await this.request("GET", "/invoices", input, options);
    return { raw };
  }

  async createCreditNote(
    input: CreateCreditNoteInput,
    options: ExternalRequestOptions,
  ): Promise<CreateCreditNoteResult> {
    const raw = await this.request("POST", "/credit-notes", input, options);
    const externalCreditNoteId = this.extractResourceId(raw);
    if (!externalCreditNoteId) {
      throw new ExternalServiceUnavailableError(
        "CREATE_CREDIT_NOTE",
        "Response did not include a resource id",
      );
    }
    return { externalCreditNoteId, raw };
  }

  async queryCreditNotes(
    input: QueryCreditNoteInput,
    options: ExternalRequestOptions,
  ): Promise<QueryCreditNoteResult> {
    const raw = await this.request("GET", "/credit-notes", input, options);
    return { raw };
  }

  private extractResourceId(raw: Record<string, unknown>): string | undefined {
    const id = raw["id"] ?? raw["resourceId"] ?? raw["invoiceId"] ?? raw["creditNoteId"];
    return typeof id === "string" ? id : undefined;
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    options: ExternalRequestOptions,
  ): Promise<Record<string, unknown>> {
    const timeoutMs = options.timeoutMs ?? env.BILLING_BACKEND_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const url =
      method === "GET" && body && typeof body === "object"
        ? `${this.baseUrl}${path}?${new URLSearchParams(sanitizeQuery(body as Record<string, unknown>)).toString()}`
        : `${this.baseUrl}${path}`;

    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.BILLING_BACKEND_API_KEY}`,
          "Idempotency-Key": options.idempotencyKey,
          "X-Correlation-Id": options.correlationId,
        },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as HttpErrorBody;
        const message = errorBody.message ?? `HTTP ${response.status}`;
        if (response.status >= 500 || response.status === 429) {
          throw new ExternalServiceUnavailableError(path, message);
        }
        // 4xx (excluding 429): the request was understood and rejected — not recoverable by retrying as-is.
        throw new ExternalServiceUnavailableError(
          path,
          `Non-recoverable error (${response.status}): ${message}`,
        );
      }

      return (await response.json()) as Record<string, unknown>;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // The request may have already reached the server before the client gave up waiting.
        logger.warn(
          { path, idempotencyKey: options.idempotencyKey },
          "Billing backend call timed out — outcome uncertain",
        );
        throw new ExternalOperationUncertainError(path, options.idempotencyKey);
      }
      if (err instanceof ExternalServiceUnavailableError) throw err;

      logger.error({ err, path }, "Billing backend call failed before a response was received");
      throw new ExternalServiceUnavailableError(
        path,
        err instanceof Error ? err.message : "Unknown network error",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function sanitizeQuery(input: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = String(value);
    }
  }
  return result;
}

export const billingBackendClient: BillingBackendClient = new HttpBillingBackendClient();
