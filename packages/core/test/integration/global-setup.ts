import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { loadRootEnv } from "@repo/config/env";

/**
 * Applies migrations to the dedicated test database before the integration suite.
 * Requires TEST_DATABASE_URL (see .env.example); refuses to run against DATABASE_URL.
 */
export default function setup() {
  loadRootEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is required for integration tests");
  if (url === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL");
  execSync("npx prisma migrate deploy", {
    cwd: resolve(import.meta.dirname, "../../../db"),
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: "pipe",
  });
}
