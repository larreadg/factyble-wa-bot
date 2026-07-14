import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  ALLOWED_ORIGINS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  WHATSAPP_API_VERSION: z.string().default("v21.0"),
  WHATSAPP_APP_ID: z.string().min(1, "WHATSAPP_APP_ID is required"),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1, "WHATSAPP_PHONE_NUMBER_ID is required"),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().min(1, "WHATSAPP_BUSINESS_ACCOUNT_ID is required"),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1, "WHATSAPP_ACCESS_TOKEN is required"),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1, "WHATSAPP_VERIFY_TOKEN is required"),
  WHATSAPP_APP_SECRET: z.string().min(1, "WHATSAPP_APP_SECRET is required"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_BUSY_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

  BILLING_BACKEND_BASE_URL: z.string().min(1, "BILLING_BACKEND_BASE_URL is required"),
  BILLING_BACKEND_API_KEY: z.string().min(1, "BILLING_BACKEND_API_KEY is required"),
  BILLING_BACKEND_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),

  SESSION_DEFAULT_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  SESSION_LOCK_TTL_SECONDS: z.coerce.number().int().positive().default(30),
  SESSION_MAX_INVALID_ATTEMPTS: z.coerce.number().int().positive().default(3),
  SESSION_EXTERNAL_WAIT_TTL_MINUTES: z.coerce.number().int().positive().default(10),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", z.treeifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
