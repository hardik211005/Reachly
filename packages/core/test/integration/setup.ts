import { afterAll } from "vitest";
import { loadRootEnv } from "@repo/config/env";

loadRootEnv();
// Point every client at the test database before any module opens a connection.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DIRECT_URL = process.env.TEST_DATABASE_URL;
process.env.QUEUE_DRIVER = "inline";
process.env.DEMO_MODE = "true";
// Tests drive provider events explicitly instead of the demo simulator.
process.env.DEMO_SIMULATE_EVENTS = "false";
// External services are never called from tests; n8n steps use the demo client.
process.env.N8N_URL = "";
process.env.AI_DEFAULT_PROVIDER = "mock";
process.env.LOG_LEVEL = "fatal";

afterAll(async () => {
  const { disconnectPrisma } = await import("@repo/db");
  await disconnectPrisma();
});
