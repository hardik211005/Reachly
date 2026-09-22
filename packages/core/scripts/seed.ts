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
// The demo workspace is a fixture: repeatable, offline, and never sends anything real —
// whatever providers and keys the .env has for everyday use.
process.env.DEMO_MODE = "true";
process.env.DEMO_SIMULATE_EVENTS = "true";
process.env.LEAD_PROVIDER = "mock";
process.env.ENRICHMENT_WEBSITE_FETCH_ENABLED = "false";
process.env.AI_DEFAULT_PROVIDER = "mock";
process.env.EMAIL_PROVIDER = "mock";
process.env.WHATSAPP_PROVIDER = "mock";
process.env.VOICE_PROVIDER = "mock";
process.env.LOG_LEVEL ??= "warn";

const { disconnectPrisma } = await import("@repo/db");
const { seedDemoWorkspace, DEMO_USER, DEMO_ORG_NAME } = await import("../src/seed/demo-workspace");
const { seedDemoOutreach } = await import("../src/seed/demo-outreach");
const { seedDemoCalls } = await import("../src/seed/demo-calls");
const { seedDemoWorkflows } = await import("../src/seed/demo-workflows");
const { seedDemoCrm } = await import("../src/seed/demo-crm");
const { generateInsights } = await import("../src/insights/service");

const started = Date.now();
const { ctx, userId } = await seedDemoWorkspace(hashPassword);
const campaigns = await seedDemoOutreach(ctx);
const calls = await seedDemoCalls(ctx);
const workflows = await seedDemoWorkflows(ctx);
const crm = await seedDemoCrm(ctx, userId);
const insights = await generateInsights(ctx);

console.log(`\nSeeded "${DEMO_ORG_NAME}" in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.table(campaigns);
console.log(`Calls: ${calls.completed} conversations, ${calls.unreached} unanswered, ${calls.queued} waiting in the queue`);
console.log(`Workflows: ${workflows.live} live, ${workflows.drafts} drafts, ${workflows.runs} runs replayed`);
console.log(`CRM: ${crm.deals} deals (${crm.won} won), ${crm.quotes} quotes, ${crm.tasks} next steps, ${crm.meetings} upcoming meetings`);
console.log(`Insights: ${insights.generated} from ${insights.considered} candidates`);
console.log(`Sign in with ${DEMO_USER.email} / ${DEMO_USER.password}\n`);
await disconnectPrisma();
process.exit(0);
