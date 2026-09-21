"use client";

import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { cn } from "@repo/ui";
import { ChannelDashboard, ProviderCard } from "./channel-dashboard";

export interface EmailSettingsSummary {
  from: string | null;
  replyTo: string | null;
  postalAddress: boolean;
  footer: boolean;
  unsubscribeLink: boolean;
  firstTouchApproval: boolean;
  sendWindow: string;
}

function Check2({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-[13px]">
      <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full", ok ? "bg-success-soft text-success-text" : "bg-surface-muted text-foreground-muted")}>
        {ok ? <Check className="size-2.5" /> : <Minus className="size-2.5" />}
      </span>
      <span className={ok ? "text-foreground-secondary" : "text-foreground-muted"}>{children}</span>
    </li>
  );
}

export function EmailView({ settings }: { settings: EmailSettingsSummary }) {
  return (
    <ChannelDashboard
      channel="EMAIL"
      labels={{ engaged: "Opened", replied: "Reply rate" }}
      aside={(data) => (
        <>
          <ProviderCard title="Email provider" provider={data.provider}>
            {data.provider.ok && settings.from ? (
              <dl className="mt-3 grid gap-1.5 text-[13px]">
                <div className="flex justify-between gap-3">
                  <dt className="shrink-0 text-foreground-muted">From</dt>
                  <dd className="min-w-0 truncate" title={settings.from}>
                    {settings.from}
                  </dd>
                </div>
                {settings.replyTo ? (
                  <div className="flex justify-between gap-3">
                    <dt className="shrink-0 text-foreground-muted">Replies to</dt>
                    <dd className="min-w-0 truncate" title={settings.replyTo}>
                      {settings.replyTo}
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
            <p className="mt-3 text-xs leading-relaxed text-foreground-muted">
              Opens are tracked by your provider and are approximate — some clients block tracking pixels. Replies and bounces arrive through signed webhooks.
            </p>
          </ProviderCard>
          <section className="rounded-lg border border-border bg-surface p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold">Sending safeguards</h3>
              <Link href="/app/settings" className="text-xs font-medium text-accent hover:underline">
                Edit
              </Link>
            </div>
            <ul className="mt-3 grid gap-2">
              <Check2 ok={settings.unsubscribeLink}>Unsubscribe link + one-click List-Unsubscribe header</Check2>
              <Check2 ok={settings.postalAddress}>Postal address in the footer</Check2>
              <Check2 ok={settings.footer}>Custom footer</Check2>
              <Check2 ok={settings.firstTouchApproval}>First message to a lead needs approval</Check2>
              <Check2 ok>Replies, bounces and complaints stop the sequence</Check2>
              <Check2 ok>Send window: {settings.sendWindow}</Check2>
            </ul>
          </section>
        </>
      )}
    />
  );
}
