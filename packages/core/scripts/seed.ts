/**
 * Seeds the demo workspace used in demo mode and screenshots.
 *   npm run db:seed
 * Every analytics number in the demo comes from rows this script writes through the same
 * domain services the app uses — nothing is hard-coded in the UI.
 */
import { hashPassword } from "better-auth/crypto";
import { loadRootEnv } from "@repo/config/env";

loadRootEnv();
process.env.QUEUE_DRIVER = "inline";
process.env.LOG_LEVEL ??= "warn";

const { disconnectPrisma } = await import("@repo/db");
const { seedDemoWorkspace, DEMO_USER, DEMO_ORG_NAME } = await import("../src/seed/demo-workspace");

const started = Date.now();
const { ctx } = await seedDemoWorkspace(hashPassword);
void ctx;

console.log(`\nSeeded "${DEMO_ORG_NAME}" in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`Sign in with ${DEMO_USER.email} / ${DEMO_USER.password}\n`);
await disconnectPrisma();
process.exit(0);
