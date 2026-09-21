import { registerMockAgent } from "../service";
import { businessUnderstandingAgent } from "./business-understanding";

export { businessUnderstandingAgent };

/** Every agent registers its deterministic mock so demo mode covers the whole product. */
const ALL_AGENTS = [businessUnderstandingAgent];
for (const agent of ALL_AGENTS) registerMockAgent(agent);
