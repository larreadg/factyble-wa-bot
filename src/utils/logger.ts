import pino, { type LoggerOptions } from "pino";
import { env } from "../config/env.js";

const options: LoggerOptions = {
  level: env.NODE_ENV === "production" ? "info" : "debug",
};

if (env.NODE_ENV !== "production") {
  options.transport = { target: "pino-pretty", options: { colorize: true } };
}

export const logger = pino(options);
