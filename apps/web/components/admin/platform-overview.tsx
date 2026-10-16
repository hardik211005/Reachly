"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Megaphone,
  Rocket,
  Telescope,
  Trash2,
  Trophy,
  UserPlus,
} from "lucide-react";
import { Badge, cn } from "@repo/ui";
import { ChartCard, SERIES_COLORS, TimeSeriesChart } from "@repo/ui/charts";

export interface ActivityDay {
  date: string;
  signups: number;
  workspaces: number;
  leads: number;
  searches: number;
  sent: number;
}
export interface FeedItem {
  at: string;
  kind: "signup" | "onboarded" | "search" | "campaign" | "deal" | "deleted" | "problem";
  title: string;
  detail: string | null;
  workspaceId: string | null;
  workspace: string | null;
}
export interface PlatformHealth {
  failures: Array<{ label: string; count: number }>;
  totalFailures: number;
  providers: Array<{ label: string; value: string; live: boolean }>;
  demoMode: boolean;
}

const FEED_ICON = {
  signup: UserPlus,
  onboarded: Rocket,
  search: Telescope,
  campaign: Megaphone,
  deal: Trophy,
  deleted: Trash2,
  problem: AlertTriangle,
} as const;
const FEED_TONE: Record<FeedItem["kind"], string> = {
  signup: "bg-accent-soft text-accent-soft-foreground",
  onboarded: "bg-success-soft text-success-text",
  search: "bg-surface-muted text-foreground-secondary",
  campaign: "bg-accent-soft text-accent-soft-foreground",
  deal: "bg-success-soft text-success-text",
  deleted: "bg-danger-soft text-danger-text",
  problem: "bg-danger-soft text-danger-text",
};

// Fixed locale + UTC so server and browser render identical text.
const DAY_LABEL = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const dayLabel = (value: string) => DAY_LABEL.format(new Date(`${value}T00:00:00Z`));

/** "5 min ago", measured from the server's snapshot time so both renders agree. */
function ago(at: string, now: string) {
  const minutes = Math.max(
    0,
    Math.round((new Date(now).getTime() - new Date(at).getTime()) / 60_000),
  );
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function PlatformOverview({
  activity,
  feed,
  health,
  now,
}: {
  activity: ActivityDay[];
  feed: FeedItem[];
  health: PlatformHealth;
  now: string;
}) {
  const totals = activity.reduce(
    (sum, day) => ({
      signups: sum.signups + day.signups,
      leads: sum.leads + day.leads,
      searches: sum.searches + day.searches,
      sent: sum.sent + day.sent,
    }),
    { signups: 0, leads: 0, searches: 0, sent: 0 },
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-4">
        <ChartCard
          title="Growth"
          description={`Last ${activity.length} days · ${totals.signups} sign-ups, ${totals.leads.toLocaleString("en-IN")} leads found, ${totals.searches} searches`}
          legend={[
            { label: "Sign-ups", color: SERIES_COLORS[0]! },
            { label: "Searches", color: SERIES_COLORS[1]! },
          ]}
          height={220}
        >
          <TimeSeriesChart
            data={activity as unknown as Array<Record<string, number | string>>}
            xKey="date"
            xFormat={dayLabel}
            series={[
              { key: "signups", label: "Sign-ups", slot: 0 },
              { key: "searches", label: "Searches", slot: 1 },
            ]}
          />
        </ChartCard>
        <ChartCard title="Leads found per day" description="Across every workspace" height={200}>
          <TimeSeriesChart
            data={activity as unknown as Array<Record<string, number | string>>}
            xKey="date"
            xFormat={dayLabel}
            variant="area"
            series={[{ key: "leads", label: "Leads", slot: 0 }]}
          />
        </ChartCard>

        <section className="rounded-xl border border-border bg-surface p-4 shadow-xs">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-[14px] font-semibold">Problems · last 24 hours</h2>
            {health.totalFailures === 0 ? (
              <Badge tone="success">
                <CheckCircle2 className="size-3" /> All clear
              </Badge>
            ) : (
              <Badge tone="danger">{health.totalFailures} failures</Badge>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {health.failures.map((item) => (
              <div
                key={item.label}
                className={cn(
                  "rounded-lg border px-3 py-2",
                  item.count
                    ? "border-critical/30 bg-danger-soft/40"
                    : "border-border bg-surface-muted/40",
                )}
              >
                <p
                  className={cn(
                    "font-heading text-xl font-semibold tabular-nums",
                    item.count ? "text-danger-text" : "",
                  )}
                >
                  {item.count}
                </p>
                <p className="text-[11.5px] text-foreground-muted">{item.label}</p>
              </div>
            ))}
          </div>
          <h3 className="mt-4 mb-2 text-[12.5px] font-semibold text-foreground-secondary">
            Services
          </h3>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {health.providers.map((provider) => (
              <li
                key={provider.label}
                className="flex items-center justify-between gap-2 rounded-md bg-surface-muted/40 px-2.5 py-1.5 text-[12.5px]"
              >
                <span className="text-foreground-secondary">{provider.label}</span>
                <span
                  className={cn(
                    "flex items-center gap-1.5 truncate font-medium",
                    provider.live ? "text-foreground" : "text-foreground-muted",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      provider.live ? "bg-success" : "bg-border-strong",
                    )}
                  />{" "}
                  {provider.value}
                </span>
              </li>
            ))}
          </ul>
          {health.demoMode ? (
            <p className="mt-2 text-[12px] text-warning-text">
              Demo mode is on — messages and calls are simulated.
            </p>
          ) : null}
        </section>
      </div>

      <section className="rounded-xl border border-border bg-surface shadow-xs">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-[14px] font-semibold">Live activity</h2>
          <span className="text-[11.5px] text-foreground-muted">Every workspace</span>
        </header>
        {feed.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-foreground-muted">
            Nothing has happened yet.
          </p>
        ) : (
          <ol className="max-h-[780px] divide-y divide-border overflow-y-auto">
            {feed.map((item, index) => {
              const Icon = FEED_ICON[item.kind];
              const body = (
                <div className="flex gap-3 px-4 py-3">
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full",
                      FEED_TONE[item.kind],
                    )}
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-snug font-medium">{item.title}</p>
                    {item.detail ? (
                      <p className="mt-0.5 truncate text-[12px] text-foreground-muted">
                        {item.detail}
                      </p>
                    ) : null}
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-foreground-subtle">
                      {item.workspace ? (
                        <>
                          <Building2 className="size-3" /> {item.workspace} ·{" "}
                        </>
                      ) : null}
                      <time dateTime={item.at}>{ago(item.at, now)}</time>
                    </p>
                  </div>
                </div>
              );
              return (
                <li key={`${item.kind}-${item.at}-${index}`}>
                  {item.workspaceId && item.kind !== "deleted" ? (
                    <Link
                      href={`/admin/workspaces/${item.workspaceId}`}
                      className="block transition-colors hover:bg-surface-muted/50"
                    >
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
