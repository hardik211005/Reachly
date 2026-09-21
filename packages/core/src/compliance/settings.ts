import { z } from "zod";
import { audit } from "../audit";
import { assertCan, type TenantContext } from "../context";
import { PreconditionError } from "../errors";

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
