import type { Channel, SuppressionReason, SuppressionType } from "@repo/db";
import type { TenantContext } from "../context";
import { audit } from "../audit";
import { recordEvent } from "../events";
import { normalizeDomain, normalizeEmail, normalizePhone } from "../leads/normalize";

/**
 * Do-not-contact list. A suppression is keyed by scope (global or one campaign),
 * channel (or all channels) and a normalised value (email, phone, domain or lead id).
 * Every send path calls `isSuppressed` before contacting anyone.
 */

export interface SuppressionTarget {
  leadId?: string | null;
  email?: string | null;
  phone?: string | null;
  domain?: string | null;
}

function suppressionKey(scope: "GLOBAL" | "CAMPAIGN", campaignId: string | null, channel: Channel | null, type: SuppressionType, value: string) {
  return `${scope}:${campaignId ?? "*"}:${channel ?? "*"}:${type}:${value}`;
}

function entries(target: SuppressionTarget): Array<{ type: SuppressionType; value: string }> {
  const list: Array<{ type: SuppressionType; value: string }> = [];
  if (target.leadId) list.push({ type: "LEAD", value: target.leadId });
  const email = normalizeEmail(target.email);
  if (email) list.push({ type: "EMAIL", value: email });
  const phone = normalizePhone(target.phone);
  if (phone) list.push({ type: "PHONE", value: phone });
  const domain = target.domain ? normalizeDomain(target.domain) : null;
  if (domain) list.push({ type: "DOMAIN", value: domain });
  return list;
}

export async function addSuppression(
  ctx: TenantContext,
  target: SuppressionTarget,
  options: { reason: SuppressionReason; scope?: "GLOBAL" | "CAMPAIGN"; campaignId?: string | null; channel?: Channel | null; sourceType?: string; sourceId?: string; note?: string },
) {
  const scope = options.scope ?? "GLOBAL";
  const campaignId = scope === "CAMPAIGN" ? (options.campaignId ?? null) : null;
  const channel = options.channel ?? null;
  const rows = entries(target);
  for (const row of rows) {
    const key = suppressionKey(scope, campaignId, channel, row.type, row.value);
    await ctx.db.suppression.upsert({
      where: { organizationId_key: { organizationId: ctx.organizationId, key } },
      create: {
        organizationId: ctx.organizationId,
        key,
        scope,
        campaignId,
        channel,
        type: row.type,
        value: row.value,
        reason: options.reason,
        sourceType: options.sourceType ?? null,
        sourceId: options.sourceId ?? null,
        note: options.note ?? null,
        createdById: ctx.userId,
      },
      update: {},
    });
  }

  if (target.leadId && scope === "GLOBAL" && !channel) {
    await ctx.db.lead.updateMany({ where: { id: target.leadId }, data: { doNotContact: true, status: "DO_NOT_CONTACT" } });
    // Stop every running sequence for this lead.
    await ctx.db.campaignLead.updateMany({
      where: { leadId: target.leadId, status: { in: ["PENDING", "IN_SEQUENCE", "AWAITING_APPROVAL"] } },
      data: { status: "OPTED_OUT", stoppedReason: `Suppressed: ${options.reason.toLowerCase()}`, nextActionAt: null },
    });
    await ctx.db.message.updateMany({
      where: { leadId: target.leadId, status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "QUEUED"] } },
      data: { status: "CANCELED", error: "Lead opted out" },
    });
  } else if (target.leadId && scope === "CAMPAIGN" && campaignId) {
    await ctx.db.campaignLead.updateMany({
      where: { leadId: target.leadId, campaignId, status: { in: ["PENDING", "IN_SEQUENCE", "AWAITING_APPROVAL"] } },
      data: { status: "OPTED_OUT", stoppedReason: `Suppressed for this campaign: ${options.reason.toLowerCase()}`, nextActionAt: null },
    });
  }

  if (options.reason === "OPT_OUT" || options.reason === "UNSUBSCRIBE") {
    await recordEvent(ctx, {
      type: "opt_out",
      leadId: target.leadId ?? null,
      campaignId,
      channel,
      properties: { reason: options.reason, scope, source: options.sourceType ?? null },
      idempotencyKey: options.sourceId ? `opt_out:${options.sourceId}` : undefined,
    });
  }
  await audit(ctx, { action: "suppression.added", resourceType: "suppression", resourceId: target.leadId ?? null, metadata: { reason: options.reason, scope, channel } });
  return rows.length;
}

/** True if any identifier of the target is suppressed for this channel/campaign. */
export async function isSuppressed(ctx: TenantContext, target: SuppressionTarget, options: { channel: Channel; campaignId?: string | null }) {
  const rows = entries(target);
  if (!rows.length) return { suppressed: false as const };
  const match = await ctx.db.suppression.findFirst({
    where: {
      OR: rows.map((row) => ({ type: row.type, value: row.value })),
      AND: [
        { OR: [{ scope: "GLOBAL" }, { scope: "CAMPAIGN", campaignId: options.campaignId ?? "00000000-0000-0000-0000-000000000000" }] },
        { OR: [{ channel: null }, { channel: options.channel }] },
      ],
    },
  });
  return match ? { suppressed: true as const, reason: match.reason, type: match.type } : { suppressed: false as const };
}

export async function removeSuppression(ctx: TenantContext, id: string) {
  const row = await ctx.db.suppression.findFirst({ where: { id } });
  if (!row) return;
  await ctx.db.suppression.delete({ where: { id } });
  await audit(ctx, { action: "suppression.removed", resourceType: "suppression", resourceId: id, metadata: { type: row.type, reason: row.reason } });
}

export async function listSuppressions(ctx: TenantContext, options: { page?: number; pageSize?: number; q?: string } = {}) {
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 50;
  const where = options.q ? { value: { contains: options.q.toLowerCase() } } : {};
  const [items, total] = await Promise.all([
    ctx.db.suppression.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    ctx.db.suppression.count({ where }),
  ]);
  return { items, total };
}
