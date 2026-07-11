import express, { type Request } from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env.js";
import { router } from "./routes/index.js";
import { requestLogger } from "./middleware/request-logger.middleware.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.middleware.js";

export const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.ALLOWED_ORIGINS.length > 0 ? env.ALLOWED_ORIGINS : false,
  }),
);

// Capture the raw body alongside JSON parsing: signature verification needs the
// exact bytes Meta signed, which re-serializing `req.body` would not reproduce.
app.use(
  express.json({
    verify: (req: Request, _res, buf) => {
      req.rawBody = Buffer.from(buf);
    },
  }),
);

app.use(requestLogger);
app.use(router);

app.use(notFoundHandler);
app.use(errorHandler);
