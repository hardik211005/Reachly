import { systemContext } from "../context";
import { deliverWebhook, fanOutToEndpoints } from "../workflows/endpoints";
import { executeWorkflow, triggerForEvent, workflowTick } from "../workflows/engine";
import { registerEventSubscriber } from "./events";
import { registerProcessor } from "./registry";

registerProcessor("workflows.execute", async ({ organizationId, executionId }) => executeWorkflow(systemContext(organizationId), executionId));

registerProcessor("workflows.resume-due", async () => workflowTick());

registerProcessor("webhooks.deliver", async ({ deliveryId }) => deliverWebhook(deliveryId));

registerEventSubscriber("workflows", async (ctx, event) => {
  await triggerForEvent(ctx, event);
});

registerEventSubscriber("outbound-webhooks", async (ctx, event) => {
  await fanOutToEndpoints(ctx, event);
});
