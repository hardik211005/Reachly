import { analyzeCall, executeCallStart } from "../calls/service";
import "../calls/simulator";
import "../calls/webhooks";
import { systemContext } from "../context";
import { registerProcessor } from "./registry";

registerProcessor("calls.start", async ({ organizationId, callId }) => executeCallStart(systemContext(organizationId), callId));

registerProcessor("calls.analyze", async ({ organizationId, callId }) => analyzeCall(systemContext(organizationId), callId));
