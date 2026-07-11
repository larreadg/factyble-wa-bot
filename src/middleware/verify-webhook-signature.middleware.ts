import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { UnauthorizedError } from "../utils/errors.js";

/**
 * Meta signs webhook deliveries with X-Hub-Signature-256, an HMAC-SHA256 of the raw
 * body keyed by the app secret. Must run after a body parser configured to capture
 * `req.rawBody` (see app.ts), since re-serializing the parsed JSON would not match.
 */
export function verifyWebhookSignature(req: Request, _res: Response, next: NextFunction): void {
  const signatureHeader = req.get("x-hub-signature-256");

  if (!signatureHeader || !req.rawBody) {
    throw new UnauthorizedError("Missing webhook signature");
  }

  const expectedSignature = `sha256=${crypto
    .createHmac("sha256", env.WHATSAPP_APP_SECRET)
    .update(req.rawBody)
    .digest("hex")}`;

  const signatureBuffer = Buffer.from(signatureHeader);
  const expectedBuffer = Buffer.from(expectedSignature);

  const isValid =
    signatureBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(signatureBuffer, expectedBuffer);

  if (!isValid) {
    throw new UnauthorizedError("Invalid webhook signature");
  }

  next();
}
