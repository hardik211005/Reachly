import { brand } from "@repo/config";
import { getEnv } from "@repo/config/env";
import { prisma } from "@repo/db";
import { systemContext } from "../context";
import { getConnectedIntegration } from "../integrations/credentials";
import { logger } from "../logger";
import { purgeDeletedWorkspaces } from "../organizations/lifecycle";
import { registerProcessor } from "./registry";

/** Delivers a notification to external channels (Slack incoming webhook) when configured. */
registerProcessor("notifications.deliver", async ({ notificationId }) => {
  const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!notification) return { skipped: "missing" };
  const ctx = systemContext(notification.organizationId);
  const slack = await getConnectedIntegration(ctx, "NOTIFICATION", "slack");
  const webhookUrl = slack?.credentials.webhookUrl ?? getEnv().SLACK_WEBHOOK_URL;
  if (!webhookUrl) return { delivered: [] };

  const link = notification.link ? `${getEnv().APP_URL}${notification.link}` : null;
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: `*${notification.title}*${notification.body ? `\n${notification.body}` : ""}${link ? `\n<${link}|Open in ${brand.name}>` : ""}`,
    }),
  });
  if (!response.ok) throw new Error(`Slack webhook responded ${response.status}`);
  return { delivered: ["slack"] };
});

/** Daily cleanup of expired caches and old processed webhook payloads. */
registerProcessor("maintenance.cleanup", async () => {
  const now = new Date();
  const [cache, webhooks, verifications] = await Promise.all([
    prisma.aICacheEntry.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.webhookEvent.deleteMany({
      where: { status: { in: ["PROCESSED", "IGNORED"] }, receivedAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } },
    }),
    prisma.verification.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
  // Workspaces deleted more than WORKSPACE_PURGE_DAYS ago are removed for good.
  const { purged } = await purgeDeletedWorkspaces(now);
  logger.info({ cache: cache.count, webhooks: webhooks.count, verifications: verifications.count, workspacesPurged: purged }, "maintenance cleanup");
  return { cache: cache.count, webhooks: webhooks.count, verifications: verifications.count, workspacesPurged: purged };
});
