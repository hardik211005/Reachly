"use client";

import Link from "next/link";
import { FlaskConical, Mail, MessageCircle, Phone, PhoneCall, PlugZap } from "lucide-react";
import {
  AUTOMATION_MODE_LABELS,
  CAMPAIGN_STATUS_LABELS,
  CHANNEL_LABELS,
  MESSAGE_STATUS_LABELS,
  REPLY_INTENT_LABELS,
  type AutomationMode,
  type Channel,
  type ReplyIntent,
} from "@repo/config";
import { Badge, StatusBadge, Tooltip, cn, type StatusTone } from "@repo/ui";

// ----------------------------------------------------------------------------- Channels

export const CHANNEL_ICONS: Record<Channel, typeof Mail> = { EMAIL: Mail, WHATSAPP: MessageCircle, VOICE: PhoneCall, MANUAL_CALL: Phone };

export function ChannelIcon({ channel, className }: { channel: Channel; className?: string }) {
  const Icon = CHANNEL_ICONS[channel];
  return <Icon aria-label={CHANNEL_LABELS[channel]} className={cn("size-3.5", className)} />;
}

/** Compact channel chips, e.g. on campaign cards. */
export function ChannelList({ channels, className }: { channels: Channel[]; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {channels.map((channel) => (
        <Tooltip key={channel} content={CHANNEL_LABELS[channel]}>
          <span className="flex size-6 items-center justify-center rounded-md border border-border bg-surface text-foreground-secondary">
            <ChannelIcon channel={channel} />
          </span>
        </Tooltip>
      ))}
    </span>
  );
}

// ----------------------------------------------------------------------------- Status badges

const CAMPAIGN_TONES: Record<string, StatusTone> = {
  DRAFT: "muted",
  SCHEDULED: "accent",
  ACTIVE: "success",
  PAUSED: "warning",
  COMPLETED: "neutral",
  ARCHIVED: "muted",
};

export function CampaignStatusBadge({ status }: { status: string }) {
  return <StatusBadge tone={CAMPAIGN_TONES[status] ?? "neutral"}>{CAMPAIGN_STATUS_LABELS[status] ?? status}</StatusBadge>;
}

const MESSAGE_TONES: Record<string, StatusTone> = {
  DRAFT: "muted",
  PENDING_APPROVAL: "warning",
  APPROVED: "accent",
  QUEUED: "accent",
  SENDING: "accent",
  SENT: "neutral",
  DELIVERED: "success",
  READ: "success",
  FAILED: "danger",
  BOUNCED: "danger",
  RECEIVED: "accent",
  CANCELED: "muted",
  SUPPRESSED: "danger",
};

export function MessageStatusBadge({ status, error }: { status: string; error?: string | null }) {
  const badge = <StatusBadge tone={MESSAGE_TONES[status] ?? "neutral"}>{MESSAGE_STATUS_LABELS[status] ?? status}</StatusBadge>;
  return error && ["FAILED", "BOUNCED", "SUPPRESSED", "CANCELED"].includes(status) ? (
    <Tooltip content={error}>
      <span>{badge}</span>
    </Tooltip>
  ) : (
    badge
  );
}

export function AutomationModeBadge({ mode }: { mode: AutomationMode }) {
  return (
    <Tooltip content={AUTOMATION_MODE_LABELS[mode].description}>
      <span>
        <Badge tone={mode === "AUTOMATED" ? "accent" : "neutral"}>{AUTOMATION_MODE_LABELS[mode].label}</Badge>
      </span>
    </Tooltip>
  );
}

const INTENT_TONES: Record<ReplyIntent, "success" | "accent" | "warning" | "danger" | "neutral"> = {
  POSITIVE: "success",
  MEETING_REQUEST: "success",
  PRICING_REQUEST: "success",
  QUESTION: "accent",
  NOT_NOW: "warning",
  NEGATIVE: "neutral",
  OPT_OUT: "danger",
  WRONG_PERSON: "neutral",
  OUT_OF_OFFICE: "neutral",
  OTHER: "neutral",
};

export function IntentBadge({ intent, className }: { intent: ReplyIntent; className?: string }) {
  return (
    <Badge tone={INTENT_TONES[intent]} className={className}>
      {REPLY_INTENT_LABELS[intent]}
    </Badge>
  );
}

// ----------------------------------------------------------------------------- Provider state

export interface ProviderState {
  ok: boolean;
  provider?: string;
  simulated?: boolean;
}

const PROVIDER_NAMES: Record<string, string> = { resend: "Resend", sendgrid: "SendGrid", smtp: "SMTP", meta: "WhatsApp Cloud API", mock: "Demo provider" };

/** Honest provider status: connected, simulated (demo) or not connected — never implied. */
export function ProviderPill({ state, className }: { state: ProviderState | null | undefined; className?: string }) {
  if (!state?.ok) {
    return (
      <Link href="/app/integrations" className={cn("inline-flex items-center gap-1 text-xs font-medium text-danger-text hover:underline", className)}>
        <PlugZap className="size-3" /> Not connected
      </Link>
    );
  }
  if (state.simulated) {
    return (
      <Tooltip content="Messages are recorded and simulated in demo mode — nothing is delivered to real recipients.">
        <span className={cn("inline-flex items-center gap-1 text-xs font-medium text-warning-text", className)}>
          <FlaskConical className="size-3" /> Demo provider
        </span>
      </Tooltip>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium text-success-text", className)}>
      <span className="size-1.5 rounded-full bg-good" /> {PROVIDER_NAMES[state.provider ?? ""] ?? state.provider}
    </span>
  );
}

/** Marks content produced by the demo simulator (never presented as real activity). */
export function SimulatedTag({ className }: { className?: string }) {
  return (
    <Tooltip content="Simulated in demo mode">
      <span className={cn("inline-flex items-center gap-0.5 text-[10px] font-medium tracking-wide text-warning-text uppercase", className)}>
        <FlaskConical className="size-2.5" /> Demo
      </span>
    </Tooltip>
  );
}

// ----------------------------------------------------------------------------- Templates

export const TEMPLATE_VARIABLES: Array<{ key: string; label: string }> = [
  { key: "first_name", label: "First name" },
  { key: "business_name", label: "Business" },
  { key: "locality", label: "Locality" },
  { key: "city", label: "City" },
  { key: "category", label: "Category" },
  { key: "personal_observation", label: "Observation" },
  { key: "value_proposition", label: "Value prop" },
  { key: "offer_short", label: "Offer" },
  { key: "call_to_action", label: "Call to action" },
  { key: "follow_up_hook", label: "Follow-up hook" },
  { key: "sender_name", label: "Your name" },
  { key: "sender_company", label: "Your company" },
];

/** Renders {{variables}} as subtle chips for read-only template display. */
export function TemplateText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(\{\{\s*[a-z0-9_]+\s*\}\})/gi);
  return (
    <p className={cn("text-[13px] leading-relaxed whitespace-pre-wrap text-foreground-secondary", className)}>
      {parts.map((part, index) =>
        /^\{\{/.test(part) ? (
          <span key={index} className="rounded-[3px] bg-accent-soft px-1 font-mono text-[11px] text-accent-soft-foreground">
            {part.replace(/[{}\s]/g, "")}
          </span>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </p>
  );
}

export function pct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(value < 0.1 && value > 0 ? 1 : 0)}%`;
}
