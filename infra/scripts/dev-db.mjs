#!/usr/bin/env node
/**
 * Local PostgreSQL without Docker.
 *
 * Runs a real PostgreSQL server (binaries shipped via the `embedded-postgres` npm package)
 * on localhost:54329 (so it never collides with a system PostgreSQL service) with the same credentials as infra/docker/docker-compose.yml, and
 * creates the `reachai`, `reachai_test` and `n8n` databases. Data persists in .local/postgres.
 *
 *   npm run db:local        # foreground; Ctrl+C to stop
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const root = resolve(import.meta.dirname, "../..");
const databaseDir = resolve(root, ".local/postgres");
const port = Number(process.env.LOCAL_PG_PORT ?? 54329);

const pg = new EmbeddedPostgres({
  databaseDir,
  user: "reachai",
  password: "reachai",
  port,
  persistent: true,
  onLog: (message) => { if (process.env.LOCAL_PG_DEBUG) console.log(String(message).trim()); },
  onError: (message) => console.error(String(message).trim()),
});

const fresh = !existsSync(resolve(databaseDir, "PG_VERSION"));
if (fresh) {
  console.log(`Initialising PostgreSQL cluster in ${databaseDir}`);
  await pg.initialise();
}
await pg.start();

const client = pg.getPgClient();
await client.connect();
for (const name of ["reachai", "reachai_test", "n8n"]) {
  const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  if (!rowCount) {
    await client.query(`CREATE DATABASE "${name}"`);
    console.log(`Created database ${name}`);
  }
}
await client.end();

console.log(`PostgreSQL ready on postgresql://reachai:reachai@localhost:${port}/reachai`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log("\nStopping PostgreSQL…");
  await pg.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {}, 1 << 30);
