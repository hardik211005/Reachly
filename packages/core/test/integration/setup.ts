import { afterAll } from "vitest";
import { loadRootEnv } from "@repo/config/env";

loadRootEnv();
// Point every client at the test database before any module opens a connection.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DIRECT_URL = process.env.TEST_DATABASE_URL;
process.env.QUEUE_DRIVER = "inline";
process.env.DEMO_MODE = "true";
process.env.AI_DEFAULT_PROVIDER = "mock";
process.env.LOG_LEVEL = "fatal";

afterAll(async () => {
  const { disconnectPrisma } = await import("@repo/db");
  await disconnectPrisma();
});
