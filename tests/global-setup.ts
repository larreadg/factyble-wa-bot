import { execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";

/** Runs once before the whole test run: wipes and re-migrates a dedicated SQLite file so tests never touch dev.db. */
export default function setup(): void {
  const dbPath = path.resolve(process.cwd(), "factyble-bot-test.db");

  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const file = dbPath + suffix;
    if (existsSync(file)) unlinkSync(file);
  }

  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: "file:../factyble-bot-test.db" },
  });
}
