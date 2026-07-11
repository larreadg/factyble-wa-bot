import type { NextFunction, Request, Response } from "express";
import { AppError, ValidationError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { env } from "../config/env.js";

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      status: "error",
      message: err.message,
      ...(err instanceof ValidationError && err.errors ? { errors: err.errors } : {}),
    });
    return;
  }

  logger.error({ err, url: req.originalUrl, method: req.method }, "Unhandled error");

  res.status(500).json({
    status: "error",
    message: env.NODE_ENV === "production" ? "Internal server error" : err.message,
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ status: "error", message: `Route ${req.originalUrl} not found` });
}
