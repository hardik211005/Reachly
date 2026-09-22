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
// Deterministic generated leads; real map data is never fetched from tests.
process.env.LEAD_PROVIDER = "mock";
process.env.ENRICHMENT_WEBSITE_FETCH_ENABLED = "false";
// No real payment provider is ever called; payments.test.ts sets test keys and stubs the HTTP layer.
for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"]) process.env[key] = "";
process.env.LOG_LEVEL = "fatal";

afterAll(async () => {
  const { disconnectPrisma } = await import("@repo/db");
  await disconnectPrisma();
});
