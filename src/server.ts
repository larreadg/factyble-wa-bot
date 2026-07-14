import { app } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { disconnectPrisma } from "./infrastructure/prisma.js";
import { startOutboxDispatcher } from "./services/outbox-dispatcher.service.js";
import { startSessionReaper } from "./services/session-reaper.service.js";

const server = app.listen(env.PORT, () => {
  logger.info(`Server listening on port ${env.PORT} (${env.NODE_ENV})`);
});

const stopOutboxDispatcher = startOutboxDispatcher();
const stopSessionReaper = startSessionReaper();

function shutdown(signal: string): void {
  logger.info(`${signal} received, shutting down gracefully`);
  stopOutboxDispatcher();
  stopSessionReaper();
  server.close((err) => {
    void disconnectPrisma().finally(() => {
      if (err) {
        logger.error({ err }, "Error during shutdown");
        process.exit(1);
      }
      process.exit(0);
    });
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
