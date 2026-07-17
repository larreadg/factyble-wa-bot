# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

WhatsApp conversational invoicing bot (Node.js v24, plain JavaScript/CommonJS — no TypeScript). Uses the Meta WhatsApp Cloud API, Express, and Prisma with MySQL.

## Commands

```
npm run dev              # start with node --watch (auto-restart)
npm start                # start without watch
npm run prisma:generate  # regenerate the Prisma client after editing prisma/schema.prisma
npm run prisma:migrate   # create/apply a migration (prisma migrate dev)
```

No test suite exists yet.

## Architecture

Layered request flow: `src/routes/*` → `src/validators/*` (express-validator) → `src/controllers/*` → `src/services/*`. Routes only wire paths to validators/controller handlers; controllers handle req/res; business logic belongs in services (currently empty — this is where WhatsApp message handling, invoice logic, etc. should go as they're built).

- `src/index.js` — entrypoint; creates the Express app, applies `express.json()`, mounts `src/routes`, starts listening on `env.PORT`.
- `src/routes/index.js` — aggregates and re-exports all route modules; add new route files here.
- `src/utils/env.js` — the only place `dotenv` is loaded (`require('dotenv').config()`); re-exports a plain object of named env vars. Import env vars from here rather than reading `process.env` directly elsewhere.
- `src/utils/logger.js` — minimal timestamped console logger (`info`/`warn`/`error`). No external logging library is used.
- `src/utils/prisma.js` — the single shared `PrismaClient` instance, wired with the MariaDB driver adapter (see below); import this rather than instantiating `PrismaClient` elsewhere.

## API conventions

- **Input validation**: every REST endpoint that accepts a body/query/params must validate input with [`express-validator`](https://express-validator.github.io/), not manual `if (!field)` checks in the controller. Pattern (see `src/validators/empresa.validator.js`, `src/validators/contacto.validator.js`):
  1. Write a `src/validators/<resource>.validator.js` exporting an array of `express-validator` chains per action (e.g. `create`), using `body()`/`query()`/`param()`.
  2. Wire it into the route as `router.post('/path', ...otherMiddleware, resourceValidator.create, validate, resourceController.create)` — `src/middlewares/validate.middleware.js` runs `validationResult` and short-circuits with a `400` `Response.error(...)` (see below) if there are errors, so it must come right after the validator chain and before the controller.
  3. Controllers can then destructure `req.body`/`req.query`/`req.params` directly (no `|| {}` guards) — validation has already guaranteed required fields are present.
- **Response envelope**: every JSON response (success or error) must be built with the `Response` class in `src/utils/response.js` — never `res.json(...)` with an ad-hoc shape. Use `Response.success(data, message, code)` / `Response.error(message, code, data)`, then `res.status(response.code).json(response)`. This applies to controllers and to middlewares that short-circuit a request (e.g. `apiKey.middleware.js`, `validate.middleware.js`).
  - Exception: `src/controllers/webhook.controller.js` talks to Meta's webhook contract, which requires a raw text/status reply (the `hub.challenge` echo, bare `200`/`403`) — it does not use the `Response` envelope.

## Prisma / MySQL specifics (Prisma 7)

Prisma 7 changed how the datasource URL is configured — this project's setup deviates from prisma's own `init` defaults and from older Prisma docs, so don't "fix" it back:

- `prisma/schema.prisma` has **no `url` in the `datasource` block** — Prisma 7 rejects a schema-level `url` (`P1012`). The connection URL instead lives in `prisma.config.js` at the repo root, read from `process.env.DATABASE_URL`.
- The generator is explicitly `provider = "prisma-client-js"` (the classic generator, output to `node_modules/@prisma/client`, plain JS/CommonJS). Prisma 7's new default generator (`prisma-client`) emits TypeScript-only output with no compiled JS — do not switch to it, and if `prisma init` or similar is ever re-run, re-check `schema.prisma` still says `prisma-client-js`.
- `DATABASE_URL` must be a MySQL connection string: `mysql://USER:PASSWORD@HOST:PORT/DATABASE`.
- Prisma 7's query engine (`engineType: "client"`) no longer talks to the database directly from a bare `DATABASE_URL` — it requires a driver adapter passed to the `PrismaClient` constructor, or it throws `PrismaClientConstructorValidationError`. For MySQL that's `@prisma/adapter-mariadb` + the `mariadb` driver package (both in `dependencies`); `src/utils/prisma.js` builds `new PrismaMariaDb(DATABASE_URL)` and passes it as `{ adapter }`. `new PrismaClient()` with no args also fails now — always pass at least `{}` (or the adapter object).
- MySQL has no declarative "partial unique index" (`WHERE` clause on an index). `Conversacion` needs at most one `ABIERTA` conversation per `contactoId` — this is implemented in the migration SQL as a `STORED GENERATED` column (`NULL` unless `estado = 'ABIERTA'`) plus a plain `UNIQUE` index on that column, since MySQL treats multiple `NULL`s in a unique index as distinct. This isn't representable in `schema.prisma`, so if the `Conversacion` model changes, that generated column/index must be re-added by hand in the new migration's SQL.
- `prisma/schema.prisma` defines the MVP model: `Empresa`, `Contacto`, `Conversacion`, `Mensaje`, `MensajeArchivo`, `SesionConversacional`. Run `npm run prisma:migrate` after editing it.
- **DB naming convention: snake_case in MySQL, camelCase in Prisma/JS.** Model and field names in `schema.prisma` stay PascalCase/camelCase (so `prisma.mensajeArchivo.create(...)`, `registro.razonSocial`, etc. read naturally in JS) — but every model has `@@map("snake_case_table_name")` and every multi-word field has `@map("snake_case_column_name")` so the actual MySQL tables/columns are snake_case (e.g. table `mensaje_archivo` with column `whatsapp_media_id`, table `sesion_conversacional`). When adding a new model or field, add the matching `@@map`/`@map` up front — don't let a table or column land in the DB as bare concatenated camelCase (e.g. `mensajearchivo`).

## Environment variables

Defined in `.env` (gitignored; template in `.env.example`), loaded via `src/utils/env.js`:

- `PORT`, `NODE_ENV`, `DATABASE_URL`
- WhatsApp Cloud API: `WHATSAPP_API_VERSION`, `WHATSAPP_APP_ID`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`
