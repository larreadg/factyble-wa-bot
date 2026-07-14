import crypto from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { billingBackendClient } from "../src/clients/billing-backend.client.js";
import {
  ExternalOperationUncertainError,
  ExternalServiceUnavailableError,
} from "../src/domain/errors.js";
import { prisma } from "../src/infrastructure/prisma.js";
import { createFixture } from "./helpers/fixtures.js";
import { enqueueExternalServiceRequest } from "../src/services/external-request.service.js";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let server: Server;
let handler: Handler = (_req, res) => res.end();

beforeAll(async () => {
  server = createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(4873, "127.0.0.1", () => resolve()));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  handler = (_req, res) => res.end();
});

describe("billing backend client", () => {
  it("resolves on a successful response", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "INV-1" }));
    };

    const result = await billingBackendClient.createInvoice(
      {
        customer: { taxId: "123", name: "Juan" },
        items: [{ quantity: "1", description: "x", unitPrice: "100" }],
      },
      { idempotencyKey: "k1", correlationId: "c1" },
    );
    expect(result.externalInvoiceId).toBe("INV-1");
  });

  it("throws a non-recoverable error on 400", async () => {
    handler = (_req, res) => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "invalid tax id" }));
    };

    await expect(
      billingBackendClient.createInvoice(
        { customer: {}, items: [] },
        { idempotencyKey: "k2", correlationId: "c2" },
      ),
    ).rejects.toThrow(ExternalServiceUnavailableError);
  });

  it("throws a recoverable error on 500", async () => {
    handler = (_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "internal error" }));
    };

    await expect(
      billingBackendClient.queryInvoices(
        { criteria: "CDC", value: "x" },
        { idempotencyKey: "k3", correlationId: "c3" },
      ),
    ).rejects.toThrow(ExternalServiceUnavailableError);
  });

  it("throws an uncertain-outcome error on timeout, never a definite failure", async () => {
    handler = () => {
      // Never respond — the client must give up after its own timeout.
    };

    await expect(
      billingBackendClient.createInvoice(
        { customer: {}, items: [{ quantity: "1", description: "x", unitPrice: "1" }] },
        { idempotencyKey: "k4", correlationId: "c4", timeoutMs: 200 },
      ),
    ).rejects.toThrow(ExternalOperationUncertainError);
  });
});

describe("external service request idempotency", () => {
  it("reusing an idempotency key returns the existing request instead of creating a duplicate call", async () => {
    const { tenant } = await createFixture();
    const idempotencyKey = `ext-${crypto.randomUUID()}`;

    const first = await enqueueExternalServiceRequest(prisma, {
      tenantId: tenant.id,
      operation: "CREATE_INVOICE",
      idempotencyKey,
      correlationId: "corr-1",
      requestPayload: { a: 1 },
      now: new Date(),
    });
    const second = await enqueueExternalServiceRequest(prisma, {
      tenantId: tenant.id,
      operation: "CREATE_INVOICE",
      idempotencyKey,
      correlationId: "corr-2",
      requestPayload: { a: 1 },
      now: new Date(),
    });

    expect(second.id).toBe(first.id);
    const count = await prisma.externalServiceRequest.count({
      where: { tenantId: tenant.id, idempotencyKey },
    });
    expect(count).toBe(1);
  });
});
