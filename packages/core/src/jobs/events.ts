import type { Event } from "@repo/db";
import { systemContext, type TenantContext } from "../context";
import { logger } from "../logger";
import { registerProcessor } from "./registry";

/**
 * Event fan-out: after a trigger-worthy event is recorded, subscribers (workflow triggers,
 * outbound webhooks, notification rules, n8n forwarding) react asynchronously.
 */
export type EventSubscriber = (ctx: TenantContext, event: Event) => Promise<void>;

const subscribers: Array<{ name: string; handler: EventSubscriber }> = [];

export function registerEventSubscriber(name: string, handler: EventSubscriber): void {
  if (!subscribers.some((subscriber) => subscriber.name === name)) subscribers.push({ name, handler });
}

registerProcessor("events.fanout", async ({ organizationId, eventId }) => {
  const ctx = systemContext(organizationId);
  const event = await ctx.db.event.findFirst({ where: { id: eventId } });
  if (!event) return { skipped: "event not found" };
  const failures: string[] = [];
  // Subscribers are independent: one failing must not block the others.
  for (const subscriber of subscribers) {
    try {
      await subscriber.handler(ctx, event);
    } catch (error) {
      failures.push(subscriber.name);
      logger.error({ err: error, subscriber: subscriber.name, eventId }, "event subscriber failed");
    }
  }
  if (failures.length) throw new Error(`Event subscribers failed: ${failures.join(", ")}`);
  return { subscribers: subscribers.length };
});
