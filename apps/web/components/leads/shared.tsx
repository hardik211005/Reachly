"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Mail, Megaphone, Phone, Plus } from "lucide-react";
import { LEAD_STATUS_LABELS, type LeadStatus } from "@repo/config";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  StatusBadge,
  Tooltip,
  cn,
  toast,
  type StatusTone,
} from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";

export const STATUS_TONES: Record<LeadStatus, StatusTone> = {
  NEW: "muted",
  QUALIFIED: "accent",
  CONTACTED: "neutral",
  REPLIED: "warning",
  INTERESTED: "success",
  MEETING: "success",
  QUOTE_SENT: "accent",
  WON: "success",
  LOST: "danger",
  DO_NOT_CONTACT: "danger",
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return <StatusBadge tone={STATUS_TONES[status]}>{LEAD_STATUS_LABELS[status]}</StatusBadge>;
}

export function FitBadge({ tier }: { tier: "HIGH" | "MEDIUM" | "LOW" | null }) {
  if (!tier) return <span className="text-xs text-foreground-subtle">—</span>;
  return <Badge tone={tier === "HIGH" ? "success" : tier === "MEDIUM" ? "accent" : "neutral"}>{tier === "HIGH" ? "High fit" : tier === "MEDIUM" ? "Medium" : "Low"}</Badge>;
}

export interface LeadSignalView {
  key: string;
  label: string;
  evidence: string;
  weight: number;
  source: string;
}

export function SignalBadges({ signals, max = 3 }: { signals: LeadSignalView[]; max?: number }) {
  if (!signals.length) return <span className="text-xs text-foreground-subtle">—</span>;
  const visible = [...signals].sort((a, b) => b.weight - a.weight).slice(0, max);
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((signal) => (
        <Tooltip key={signal.key} content={`${signal.evidence} (source: ${signal.source})`}>
          <span>
            <Badge tone="neutral">{signal.label}</Badge>
          </span>
        </Tooltip>
      ))}
      {signals.length > max ? <span className="self-center text-[11px] text-foreground-muted">+{signals.length - max}</span> : null}
    </div>
  );
}

export function ContactIndicators({ email, phone }: { email: string | null | undefined; phone: string | null | undefined }) {
  return (
    <div className="flex items-center gap-1.5">
      <Tooltip content={email ?? "No email"}>
        <span className={cn("flex size-5 items-center justify-center rounded-sm", email ? "bg-accent-soft text-accent-soft-foreground" : "text-foreground-subtle")}>
          <Mail className="size-3" />
        </span>
      </Tooltip>
      <Tooltip content={phone ?? "No phone"}>
        <span className={cn("flex size-5 items-center justify-center rounded-sm", phone ? "bg-accent-soft text-accent-soft-foreground" : "text-foreground-subtle")}>
          <Phone className="size-3" />
        </span>
      </Tooltip>
    </div>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  mock: "Demo data",
  google_places: "Google Places",
  csv: "CSV import",
  manual: "Manual",
  api: "API",
};

export function SourceLabel({ provider }: { provider: string }) {
  if (provider === "mock") {
    return (
      <Tooltip content="Simulated business generated in demo mode — not a real company">
        <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-warning-text">
          <FlaskConical className="size-3" /> Demo data
        </span>
      </Tooltip>
    );
  }
  return <span className="text-xs whitespace-nowrap text-foreground-secondary">{SOURCE_LABELS[provider] ?? provider}</span>;
}

interface CampaignOption {
  id: string;
  name: string;
  status: string;
}

/** Dropdown that adds the given leads to a campaign; reports skipped (suppressed/duplicate) leads. */
export function AddToCampaignMenu({ leadIds, onDone, size = "sm" }: { leadIds: string[]; onDone?: () => void; size?: "sm" | "md" }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const campaigns = useQuery({
    queryKey: ["campaign-options"],
    queryFn: () => api<{ campaigns: CampaignOption[] }>("/api/v1/leads/filters").then((data) => data.campaigns),
  });
  const add = useMutation({
    mutationFn: (campaignId: string) =>
      api<{ added: number; skipped: Array<{ reason: string }> }>(`/api/v1/campaigns/${campaignId}/leads`, { method: "POST", json: { leadIds } }),
    onSuccess: (result) => {
      toast.success(`Added ${result.added} lead${result.added === 1 ? "" : "s"} to the campaign`, {
        description: result.skipped.length ? `${result.skipped.length} skipped (${[...new Set(result.skipped.map((s) => s.reason))].join(", ")})` : undefined,
      });
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      onDone?.();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const available = (campaigns.data ?? []).filter((campaign) => !["COMPLETED", "ARCHIVED"].includes(campaign.status));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size={size} disabled={!leadIds.length || add.isPending} loading={add.isPending}>
          <Megaphone /> Add to campaign
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Campaigns</DropdownMenuLabel>
        {available.length === 0 ? <p className="px-2 py-2 text-xs text-foreground-muted">No open campaigns yet.</p> : null}
        {available.map((campaign) => (
          <DropdownMenuItem key={campaign.id} onSelect={() => add.mutate(campaign.id)}>
            <span className="flex-1 truncate">{campaign.name}</span>
            <span className="text-[11px] text-foreground-muted lowercase">{campaign.status}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/app/campaigns/new")}>
          <Plus /> New campaign
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
