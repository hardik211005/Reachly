import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// The repo keeps a single .env at the monorepo root.
const rootEnv = resolve(import.meta.dirname, "../../.env");
if (existsSync(rootEnv)) config({ path: rootEnv, quiet: true });

// `prisma generate` does not need a live database, so fall back to a placeholder URL.
const url =
  process.env.DIRECT_URL ??
  process.env.DATABASE_URL ??
  "postgresql://placeholder:placeholder@localhost:5432/placeholder";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "npm run seed -w @repo/core",
  },
  datasource: { url },
});
