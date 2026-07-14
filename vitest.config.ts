import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: "./tests/global-setup.ts",
    testTimeout: 20000,
    hookTimeout: 20000,
    // Tests share one SQLite file; running test files in parallel workers
    // would fight over the same busy_timeout-bounded write lock and produce
    // flaky (not incorrect) failures. Sequential is deterministic and, for
    // this suite's size, fast enough.
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "file:../factyble-bot-test.db",
      DATABASE_BUSY_TIMEOUT_MS: "5000",
      WHATSAPP_API_VERSION: "v21.0",
      WHATSAPP_APP_ID: "test-app-id",
      WHATSAPP_PHONE_NUMBER_ID: "test-phone-number-id",
      WHATSAPP_BUSINESS_ACCOUNT_ID: "test-business-account-id",
      WHATSAPP_ACCESS_TOKEN: "test-access-token",
      WHATSAPP_VERIFY_TOKEN: "test-verify-token",
      WHATSAPP_APP_SECRET: "test-app-secret",
      BILLING_BACKEND_BASE_URL: "http://127.0.0.1:4873",
      BILLING_BACKEND_API_KEY: "test-billing-api-key",
      BILLING_BACKEND_TIMEOUT_MS: "1000",
      SESSION_DEFAULT_TTL_MINUTES: "30",
      SESSION_LOCK_TTL_SECONDS: "30",
      SESSION_MAX_INVALID_ATTEMPTS: "3",
      SESSION_EXTERNAL_WAIT_TTL_MINUTES: "10",
    },
  },
});
