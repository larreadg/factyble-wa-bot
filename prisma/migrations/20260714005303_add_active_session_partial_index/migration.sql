-- Defense-in-depth: a conversation must never have more than one *active*
-- session. The primary enforcement is transactional (see
-- src/services/session.service.ts, startSession/resumeSession run inside a
-- single transaction that checks-then-inserts), which is portable to any SQL
-- database. This partial unique index is a SQLite-specific extra guard that
-- makes the invariant hold even if application code has a bug — SQLite has
-- supported partial indexes (the `WHERE` clause below) since 3.8.0.
--
-- Prisma's schema language has no portable way to express a partial unique
-- index, so this is hand-written raw SQL rather than derived from
-- schema.prisma. When migrating to PostgreSQL, recreate it as:
--   CREATE UNIQUE INDEX idx_one_active_session_per_conversation
--     ON conversation_sessions ("conversationId")
--     WHERE status IN ('ACTIVE','WAITING_INPUT','VALIDATING','WAITING_EXTERNAL_SERVICE');
-- (identical syntax — Postgres partial indexes use the same WHERE clause form).
CREATE UNIQUE INDEX "idx_one_active_session_per_conversation"
  ON "conversation_sessions" ("conversationId")
  WHERE "status" IN ('ACTIVE', 'WAITING_INPUT', 'VALIDATING', 'WAITING_EXTERNAL_SERVICE');