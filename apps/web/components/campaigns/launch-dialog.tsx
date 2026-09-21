"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Rocket, ShieldCheck, X } from "lucide-react";
import { CHANNEL_LABELS, type Channel } from "@repo/config";
import { Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, ErrorState, Skeleton, cn, formatNumber, toast } from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { ChannelIcon, ProviderPill, type ProviderState } from "../outreach/shared";

interface LaunchEstimate {
  audience: number;
  eligible: Partial<Record<Channel, number>>;
  blocked: Array<{ reason: string; count: number }>;
  steps: Array<{ order: number; channel: Channel; name: string; delayDays: number; useAI: boolean }>;
  messages: Partial<Record<Channel, number>>;
  aiCredits: number;
  estimatedCostUsd: { ai: number; email: number; whatsapp: number; voice: number; total: number };
  usage: Array<{ metric: string; needed: number; remaining: number | null; ok: boolean }>;
  providers: Record<string, ProviderState>;
  warnings: string[];
  canLaunch: boolean;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

function Row({ label, value, muted }: { label: React.ReactNode; value: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
      <span className={cn(muted ? "text-foreground-muted" : "text-foreground-secondary")}>{label}</span>
      <span className="font-medium tabular">{value}</span>
    </div>
  );
}

export function LaunchDialog({ campaignId, campaignName, open, onOpenChange }: { campaignId: string; campaignName: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [confirmed, setConfirmed] = React.useState(false);
  const estimate = useQuery({
    queryKey: ["campaign-estimate", campaignId],
    queryFn: () => api<LaunchEstimate>(`/api/v1/campaigns/${campaignId}/estimate`),
    enabled: open,
    staleTime: 0,
  });
  const launch = useMutation({
    mutationFn: () => api(`/api/v1/campaigns/${campaignId}/launch`, { method: "POST", json: { confirm: true } }),
    onSuccess: () => {
      toast.success(`${campaignName} is live`);
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ["campaign", campaignId] });
      void queryClient.invalidateQueries({ queryKey: ["campaign-stats", campaignId] });
      void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const data = estimate.data;
  const channels = data ? (Object.keys(data.messages) as Channel[]) : [];
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) setConfirmed(false);
        onOpenChange(value);
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Launch {campaignName}</DialogTitle>
          <DialogDescription>Here’s exactly what will happen. Review it before anything is sent.</DialogDescription>
        </DialogHeader>

        {estimate.isPending ? (
          <div className="grid gap-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-32" />
          </div>
        ) : estimate.isError || !data ? (
          <ErrorState description={errorMessage(estimate.error)} onRetry={() => void estimate.refetch()} />
        ) : (
          <div className="grid max-h-[60vh] gap-4 overflow-y-auto pr-1">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md border border-border bg-surface-muted/60 px-3 py-2.5">
                <p className="text-[11px] text-foreground-muted">Leads</p>
                <p className="text-lg font-semibold tabular">{formatNumber(data.audience)}</p>
              </div>
              <div className="rounded-md border border-border bg-surface-muted/60 px-3 py-2.5">
                <p className="text-[11px] text-foreground-muted">Messages (max)</p>
                <p className="text-lg font-semibold tabular">{formatNumber(Object.values(data.messages).reduce((sum, value) => sum + (value ?? 0), 0))}</p>
              </div>
              <div className="rounded-md border border-border bg-surface-muted/60 px-3 py-2.5">
                <p className="text-[11px] text-foreground-muted">Est. cost</p>
                <p className="text-lg font-semibold tabular">{usd.format(data.estimatedCostUsd.total)}</p>
              </div>
            </div>

            <section>
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-foreground-muted uppercase">Volume by channel</h3>
              <div className="divide-y divide-border rounded-md border border-border px-3">
                {channels.map((channel) => (
                  <div key={channel} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                    <span className="inline-flex items-center gap-2">
                      <ChannelIcon channel={channel} className="text-foreground-muted" /> {CHANNEL_LABELS[channel]}
                      {data.providers[channel] ? <ProviderPill state={data.providers[channel]} /> : null}
                    </span>
                    <span className="text-right">
                      <span className="font-medium tabular">{formatNumber(data.messages[channel] ?? 0)}</span>
                      <span className="block text-[11px] text-foreground-muted">{formatNumber(data.eligible[channel] ?? 0)} reachable leads</span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-foreground-muted">Upper bound: every step to every reachable lead. Replies and opt-outs stop follow-ups, so real volume is lower.</p>
            </section>

            {data.blocked.length ? (
              <section>
                <h3 className="mb-1 text-xs font-semibold tracking-wide text-foreground-muted uppercase">Won’t be contacted on some channels</h3>
                <div className="rounded-md border border-border px-3">
                  {data.blocked.map((item) => (
                    <Row key={item.reason} label={item.reason} value={formatNumber(item.count)} muted />
                  ))}
                </div>
              </section>
            ) : null}

            <section>
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-foreground-muted uppercase">Credits & cost</h3>
              <div className="rounded-md border border-border px-3">
                <Row label="AI personalisation" value={`${formatNumber(data.aiCredits)} credits · ${usd.format(data.estimatedCostUsd.ai)}`} />
                {data.estimatedCostUsd.email ? <Row label="Email delivery" value={usd.format(data.estimatedCostUsd.email)} /> : null}
                {data.estimatedCostUsd.whatsapp ? <Row label="WhatsApp conversations" value={usd.format(data.estimatedCostUsd.whatsapp)} /> : null}
                {data.estimatedCostUsd.voice ? <Row label="Voice minutes" value={usd.format(data.estimatedCostUsd.voice)} /> : null}
                {data.usage.map((item) => (
                  <Row
                    key={item.metric}
                    label={
                      <span className="inline-flex items-center gap-1.5">
                        {item.ok ? <Check className="size-3.5 text-success-text" /> : <X className="size-3.5 text-danger-text" />}
                        {item.metric} remaining
                      </span>
                    }
                    value={`${item.remaining === null ? "Unlimited" : formatNumber(item.remaining)} / ${formatNumber(item.needed)} needed`}
                    muted
                  />
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-foreground-muted">Estimates. Provider costs depend on your own provider plan; AI credits are only used when a message is generated.</p>
            </section>

            {data.warnings.length ? (
              <div className="grid gap-1.5 rounded-md bg-warning-soft px-3 py-2.5 text-[13px] text-warning-text">
                {data.warnings.map((warning) => (
                  <p key={warning} className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {warning}
                  </p>
                ))}
              </div>
            ) : null}

            <label className="flex items-start gap-2.5 rounded-md border border-border p-3 text-[13px]">
              <Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} className="mt-0.5" disabled={!data.canLaunch} />
              <span>
                <span className="font-medium">I’ve reviewed the audience, messages and cost.</span>
                <span className="mt-0.5 block text-xs text-foreground-muted">
                  Outreach respects opt-outs, send windows and daily limits. You can pause the campaign at any time.
                </span>
              </span>
            </label>
          </div>
        )}

        <DialogFooter>
          <span className="mr-auto hidden items-center gap-1.5 text-xs text-foreground-muted sm:inline-flex">
            <ShieldCheck className="size-3.5" /> Compliance checks run before every send
          </span>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!confirmed || !data?.canLaunch || launch.isPending} onClick={() => launch.mutate()}>
            <Rocket /> {launch.isPending ? "Launching…" : "Launch campaign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
