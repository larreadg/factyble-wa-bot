require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL,
  API_KEY: process.env.API_KEY,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,

  WHATSAPP_API_VERSION: process.env.WHATSAPP_API_VERSION,
  WHATSAPP_APP_ID: process.env.WHATSAPP_APP_ID,
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_BUSINESS_ACCOUNT_ID: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN,
  WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET,

  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
  OPENAI_TRANSCRIPTION_MODEL: process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe',
  OPENAI_REASONING_EFFORT: process.env.OPENAI_REASONING_EFFORT || 'none',
  OPENAI_PROMPT_CACHE_KEY: process.env.OPENAI_PROMPT_CACHE_KEY || 'factyble:invoice-parser:v1',
  OPENAI_MAX_OUTPUT_TOKENS: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS) || 1000,
  OPENAI_TIMEOUT_MS: Number(process.env.OPENAI_TIMEOUT_MS) || 15000,

  // API de facturación (POST /usuario/authenticate, POST /factura/simple, GET /public/*).
  FACTURACION_API_BASE_URL: process.env.FACTURACION_API_BASE_URL,
  // Generoso por defecto: el backend de facturación espera a que JasperReports termine
  // de generar el PDF antes de responder /factura/simple.
  FACTURACION_API_TIMEOUT_MS: Number(process.env.FACTURACION_API_TIMEOUT_MS) || 30000,
};
