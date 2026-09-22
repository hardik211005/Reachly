import { z } from "zod";
import { audit } from "../audit";
import { assertCan, type TenantContext } from "../context";
import { PreconditionError } from "../errors";
import { quietHoursSchema } from "../outreach/policy";

export const callingSettingsSchema = z.object({
  callingEnabled: z.boolean(),
  recordCalls: z.boolean(),
  announceAiOnCalls: z.boolean(),
  dndCheckEnabled: z.boolean(),
  /** The admin confirms the workspace has consent or another lawful basis to call its contacts. */
  attestConsent: z.boolean(),
});

/** Calling configuration. Only admins; every change is audited with who attested consent and when. */
export async function updateCallingSettings(ctx: TenantContext, input: z.input<typeof callingSettingsSchema>) {
  assertCan(ctx, "compliance:manage");
  const data = callingSettingsSchema.parse(input);
  if (data.callingEnabled && !data.attestConsent) throw new PreconditionError("Confirm you have consent or a lawful basis to call before enabling AI calling");
  const current = await ctx.db.complianceSettings.findFirst();
  const attestationChanged = data.attestConsent !== Boolean(current?.callingConsentAttested);
  const attestation = data.attestConsent
    ? attestationChanged
      ? { callingConsentAttested: true, callingConsentAttestedAt: new Date(), callingConsentAttestedById: ctx.userId }
      : {}
    : { callingConsentAttested: false, callingConsentAttestedAt: null, callingConsentAttestedById: null };
  const values = { callingEnabled: data.callingEnabled, recordCalls: data.recordCalls, announceAiOnCalls: data.announceAiOnCalls, dndCheckEnabled: data.dndCheckEnabled, ...attestation };
  const settings = await ctx.db.complianceSettings.upsert({
    where: { organizationId: ctx.organizationId },
    create: { organizationId: ctx.organizationId, ...values },
    update: values,
  });
  await audit(ctx, { action: "compliance.calling_updated", resourceType: "compliance_settings", resourceId: settings.id, metadata: { ...data, attestationChanged } });
  return settings;
}

export const outreachComplianceSchema = z.object({
  /** Physical address appended to commercial email. */
  postalAddress: z.string().trim().max(300).nullish(),
  emailFooter: z.string().trim().max(1000).nullish(),
  /** First messages to a lead wait for approval, whatever the campaign mode. */
  requireApprovalFirstTouch: z.boolean(),
  whatsappRequireOptIn: z.boolean(),
  quietHours: quietHoursSchema.refine((value) => value.end > value.start, "The sending window must end after it starts").refine((value) => value.days.length > 0, "Pick at least one day"),
  optOutKeywords: z.array(z.string().trim().toLowerCase().min(2).max(40)).min(1, "Keep at least one opt-out keyword").max(40),
});

export async function getComplianceSettings(ctx: TenantContext) {
  assertCan(ctx, "workspace:read");
  const settings = await ctx.db.complianceSettings.findFirst();
  return {
    postalAddress: settings?.postalAddress ?? null,
    emailFooter: settings?.emailFooter ?? null,
    includeUnsubscribeLink: settings?.includeUnsubscribeLink ?? true,
    requireApprovalFirstTouch: settings?.requireApprovalFirstTouch ?? true,
    whatsappRequireOptIn: settings?.whatsappRequireOptIn ?? true,
    quietHours: quietHoursSchema.parse(settings?.quietHours ?? {}),
    optOutKeywords: settings?.optOutKeywords ?? [],
    calling: {
      callingEnabled: settings?.callingEnabled ?? false,
      callingConsentAttested: settings?.callingConsentAttested ?? false,
      callingConsentAttestedAt: settings?.callingConsentAttestedAt ?? null,
      recordCalls: settings?.recordCalls ?? false,
      announceAiOnCalls: settings?.announceAiOnCalls ?? true,
      dndCheckEnabled: settings?.dndCheckEnabled ?? true,
    },
  };
}

/** Outreach guardrails. Unsubscribe links stay on — they're not a setting. */
export async function updateOutreachCompliance(ctx: TenantContext, input: z.input<typeof outreachComplianceSchema>) {
  assertCan(ctx, "compliance:manage");
  const data = outreachComplianceSchema.parse(input);
  const values = {
    postalAddress: data.postalAddress || null,
    emailFooter: data.emailFooter || null,
    requireApprovalFirstTouch: data.requireApprovalFirstTouch,
    whatsappRequireOptIn: data.whatsappRequireOptIn,
    quietHours: data.quietHours,
    optOutKeywords: [...new Set(data.optOutKeywords)],
  };
  const settings = await ctx.db.complianceSettings.upsert({ where: { organizationId: ctx.organizationId }, create: { organizationId: ctx.organizationId, ...values }, update: values });
  await audit(ctx, { action: "compliance.outreach_updated", resourceType: "compliance_settings", resourceId: settings.id, metadata: { requireApprovalFirstTouch: values.requireApprovalFirstTouch, whatsappRequireOptIn: values.whatsappRequireOptIn, quietHours: values.quietHours, optOutKeywords: values.optOutKeywords.length } });
  return getComplianceSettings(ctx);
}
