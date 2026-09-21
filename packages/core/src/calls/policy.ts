import type { Lead } from "@repo/db";
import { resolvePlan } from "../billing/plans";
import { getUsage } from "../billing/usage";
import { isSuppressed } from "../compliance/suppression";
import type { TenantContext } from "../context";
import { AppError } from "../errors";
import { nextSendWindow, quietHoursSchema, withinSendWindow } from "../outreach/policy";
import { voiceAvailability } from "./providers";

/**
 * Calling rules. AI calls need: calling enabled, the operator's consent attestation,
 * a callable number, no do-not-contact / suppression / DND hit, the plan feature and
 * voice minutes. Real calls also respect calling hours (deferred, never dropped).
 */

export type CallBlockReason =
  | "CALLING_DISABLED"
  | "NO_CONSENT_ATTESTATION"
  | "PLAN"
  | "NO_VOICE_MINUTES"
  | "NO_PHONE"
  | "DO_NOT_CONTACT"
  | "SUPPRESSED"
  | "DND_UNVERIFIED"
  | "SIMULATED_LEAD_REAL_PROVIDER";

export class CallBlockedError extends AppError {
  override name = "CallBlockedError";
  constructor(
    public readonly reason: CallBlockReason,
    message: string,
  ) {
    super("COMPLIANCE_BLOCKED", message, 409, { reason });
  }
}

export interface ReadinessCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  /** Who can fix it: an admin in calling settings, or Integrations. */
  fix: "settings" | "integrations" | "billing" | null;
}

/** Everything the Calls page shows before anyone can place an AI call. */
export async function callReadiness(ctx: TenantContext) {
  const [compliance, provider, plan, usage] = await Promise.all([ctx.db.complianceSettings.findFirst(), voiceAvailability(ctx), resolvePlan(ctx), getUsage(ctx)]);
  const minutes = usage.metrics.find((metric) => metric.metric === "VOICE_MINUTES");
  const remaining = minutes?.remaining ?? null;
  const checks: ReadinessCheck[] = [
    {
      key: "provider",
      label: "Voice provider",
      ok: provider.ok,
      detail: provider.ok ? (provider.simulated ? "Demo provider — calls are simulated, nobody is dialled" : `Connected: ${provider.provider}`) : "Connect Vapi or Twilio to place real calls",
      fix: provider.ok ? null : "integrations",
    },
    { key: "plan", label: "AI voice agent in plan", ok: plan.features.voiceAgent, detail: plan.features.voiceAgent ? `${plan.name} plan` : `Not included in the ${plan.name} plan`, fix: plan.features.voiceAgent ? null : "billing" },
    {
      key: "minutes",
      label: "Voice minutes",
      ok: remaining === null || remaining > 0,
      detail: remaining === null ? "Unlimited" : `${remaining.toLocaleString()} of ${minutes?.limit?.toLocaleString() ?? "0"} minutes left this period`,
      fix: remaining === null || remaining > 0 ? null : "billing",
    },
    { key: "enabled", label: "Calling enabled", ok: Boolean(compliance?.callingEnabled), detail: compliance?.callingEnabled ? "AI calling is switched on" : "An admin must switch on AI calling", fix: compliance?.callingEnabled ? null : "settings" },
    {
      key: "consent",
      label: "Consent attestation",
      ok: Boolean(compliance?.callingConsentAttested),
      detail: compliance?.callingConsentAttested ? "Lawful basis to call these contacts confirmed by an admin" : "An admin must confirm you have a lawful basis/consent to call",
      fix: compliance?.callingConsentAttested ? null : "settings",
    },
    {
      key: "dnd",
      label: "DND registry check",
      ok: !compliance?.dndCheckEnabled || provider.simulated,
      detail: !compliance?.dndCheckEnabled
        ? "Not required — numbers are still checked against your suppression list"
        : provider.simulated
          ? "Required; skipped for simulated calls"
          : "Required, but no DND registry provider is connected — real calls are blocked",
      fix: !compliance?.dndCheckEnabled || provider.simulated ? null : "settings",
    },
  ];
  return {
    ready: checks.every((check) => check.ok),
    checks,
    provider,
    settings: {
      callingEnabled: Boolean(compliance?.callingEnabled),
      callingConsentAttested: Boolean(compliance?.callingConsentAttested),
      callingConsentAttestedAt: compliance?.callingConsentAttestedAt ?? null,
      recordCalls: Boolean(compliance?.recordCalls),
      announceAiOnCalls: compliance?.announceAiOnCalls ?? true,
      dndCheckEnabled: compliance?.dndCheckEnabled ?? true,
    },
    minutesRemaining: remaining,
  };
}

/** Throws `CallBlockedError` when an AI call to this lead/number must not be placed. */
export async function assertCanCall(ctx: TenantContext, lead: Pick<Lead, "id" | "doNotContact" | "sourceProvider">, phone: string | null, options: { providerIsMock: boolean }) {
  const [compliance, plan, usage] = await Promise.all([ctx.db.complianceSettings.findFirst(), resolvePlan(ctx), getUsage(ctx)]);
  if (!plan.features.voiceAgent) throw new CallBlockedError("PLAN", `AI calling isn't included in the ${plan.name} plan`);
  if (!compliance?.callingEnabled) throw new CallBlockedError("CALLING_DISABLED", "AI calling is switched off for this workspace");
  if (!compliance.callingConsentAttested) throw new CallBlockedError("NO_CONSENT_ATTESTATION", "An admin must confirm you have consent or a lawful basis to call these contacts");
  const minutes = usage.metrics.find((metric) => metric.metric === "VOICE_MINUTES");
  if (minutes && minutes.remaining !== null && minutes.remaining <= 0) throw new CallBlockedError("NO_VOICE_MINUTES", "No voice minutes left this billing period");
  if (!phone) throw new CallBlockedError("NO_PHONE", "This lead has no phone number");
  if (lead.doNotContact) throw new CallBlockedError("DO_NOT_CONTACT", "This lead is marked do-not-contact");
  const suppression = await isSuppressed(ctx, { leadId: lead.id, phone }, { channel: "VOICE" });
  if (suppression.suppressed) throw new CallBlockedError("SUPPRESSED", `This number is suppressed (${suppression.reason.toLowerCase().replace(/_/g, " ")})`);
  if (!options.providerIsMock) {
    if (lead.sourceProvider === "mock" && compliance.blockSimulatedLeadsOnRealProviders) {
      throw new CallBlockedError("SIMULATED_LEAD_REAL_PROVIDER", "Demo leads can't be called through a real provider");
    }
    if (compliance.dndCheckEnabled) {
      throw new CallBlockedError("DND_UNVERIFIED", "DND registry checks are required but no registry provider is connected. Connect one, or turn the requirement off after confirming consent.");
    }
  }
}

/** When a real call to this workspace may be placed (calling hours = the send window). */
export async function callingWindow(ctx: TenantContext, from = new Date()) {
  const [compliance, org] = await Promise.all([
    ctx.db.complianceSettings.findFirst(),
    ctx.db.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { timezone: true } }),
  ]);
  const window = quietHoursSchema.parse(compliance?.quietHours ?? {});
  return { open: withinSendWindow(from, org.timezone, window), next: nextSendWindow(from, org.timezone, window), timezone: org.timezone };
}
