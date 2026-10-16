"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge, cn } from "@repo/ui";

interface Detail {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  deletedAt: string | null;
  onboardingCompleted: boolean;
  currency: string;
  timezone: string;
  subscription: {
    status: string;
    billingProvider: string;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: string;
    plan: { name: string };
  } | null;
  memberships: Array<{
    role: string;
    createdAt: string;
    user: { name: string; email: string; emailVerified: boolean };
  }>;
  businessProfile: {
    name: string;
    industry: string;
    description: string;
    website: string | null;
    city: string | null;
    businessSize: string;
  } | null;
  scoring: {
    chainPolicy: string;
    markedChains: number;
    model: { auc: number | null; samples: number; trainedAt: string } | null;
  };
  counts: {
    leads: number;
    qualified: number;
    chains: number;
    campaigns: number;
    activeCampaigns: number;
    sent: number;
    calls: number;
    deals: number;
    wonDeals: number;
    wonValue: number;
    workflows: number;
    searches: number;
  };
  lastActivityAt: string | null;
  recentRuns: Array<{
    id: string;
    query: string;
    status: string;
    createdAt: string;
    error: string | null;
    stats: { found?: number; new?: number; qualified?: number; skippedChains?: number };
  }>;
  recentAudit: Array<{ action: string; createdAt: string; actorType: string }>;
}

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const DATETIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});
const date = (value: string | null) => (value ? DATE.format(new Date(value)) : "—");
const action = (value: string) =>
  value.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function ago(value: string | null, now: string) {
  if (!value) return "never";
  const days = Math.floor((new Date(now).getTime() - new Date(value).getTime()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3.5 shadow-xs">
      <p className="text-[11.5px] text-foreground-muted">{label}</p>
      <p className="mt-1 font-heading text-[22px] leading-none font-semibold tabular-nums">
        {value}
      </p>
      {hint ? <p className="mt-1 text-[11px] text-foreground-subtle">{hint}</p> : null}
    </div>
  );
}

function Card({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-surface shadow-xs", className)}>
      <h2 className="border-b border-border px-4 py-3 text-[14px] font-semibold">{title}</h2>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function WorkspaceDetail({ detail, now }: { detail: Detail; now: string }) {
  const { counts } = detail;
  const owner = detail.memberships.find((member) => member.role === "OWNER")?.user;
  return (
    <main>
      <div className="mx-auto grid max-w-[1200px] gap-5 px-4 py-6 sm:px-6">
        <div>
          <Link
            href="/admin"
            className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-foreground-muted hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> All workspaces
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-[26px] font-semibold tracking-[-0.03em]">
              {detail.name}
            </h1>
            {detail.deletedAt ? (
              <Badge tone="danger">Deleted {date(detail.deletedAt)}</Badge>
            ) : null}
            {!detail.onboardingCompleted ? <Badge tone="warning">Still onboarding</Badge> : null}
            <Badge>{detail.subscription?.plan.name ?? "No plan"}</Badge>
          </div>
          <p className="mt-1 text-[13px] text-foreground-secondary">
            Owner {owner ? `${owner.name} · ${owner.email}` : "—"} · registered{" "}
            {date(detail.createdAt)} · last active {ago(detail.lastActivityAt, now)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat
            label="Leads"
            value={counts.leads.toLocaleString("en-IN")}
            hint={`${counts.qualified} qualified · ${counts.chains} chains`}
          />
          <Stat label="Searches run" value={counts.searches} />
          <Stat
            label="Campaigns"
            value={counts.campaigns}
            hint={`${counts.activeCampaigns} active`}
          />
          <Stat
            label="Messages sent"
            value={counts.sent.toLocaleString("en-IN")}
            hint={`${counts.calls} calls`}
          />
          <Stat label="Deals" value={counts.deals} hint={`${counts.wonDeals} won`} />
          <Stat label="Automations on" value={counts.workflows} />
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="grid content-start gap-5">
            <Card title="Recent lead searches">
              {detail.recentRuns.length === 0 ? (
                <p className="text-[13px] text-foreground-muted">No searches yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {detail.recentRuns.map((run) => (
                    <li
                      key={run.id}
                      className="flex flex-wrap items-start justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium">{run.query}</p>
                        <p className="text-[11.5px] text-foreground-muted">
                          {DATETIME.format(new Date(run.createdAt))} UTC
                          {run.status === "COMPLETED"
                            ? ` · ${run.stats.new ?? 0} new of ${run.stats.found ?? 0} found · ${run.stats.qualified ?? 0} qualified${run.stats.skippedChains ? ` · ${run.stats.skippedChains} chains skipped` : ""}`
                            : ""}
                          {run.error ? ` · ${run.error}` : ""}
                        </p>
                      </div>
                      <Badge
                        tone={
                          run.status === "COMPLETED"
                            ? "success"
                            : run.status === "FAILED"
                              ? "danger"
                              : "neutral"
                        }
                      >
                        {run.status.toLowerCase()}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Recent changes (audit log)">
              {detail.recentAudit.length === 0 ? (
                <p className="text-[13px] text-foreground-muted">Nothing recorded yet.</p>
              ) : (
                <ul className="grid gap-1.5">
                  {detail.recentAudit.map((entry, index) => (
                    <li
                      key={index}
                      className="flex items-center justify-between gap-3 text-[12.5px]"
                    >
                      <span className="truncate">{action(entry.action)}</span>
                      <span className="shrink-0 text-foreground-subtle">
                        {DATETIME.format(new Date(entry.createdAt))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid content-start gap-5">
            <Card title="Business">
              {detail.businessProfile ? (
                <dl className="grid gap-2 text-[12.5px]">
                  <div>
                    <dt className="text-foreground-muted">Industry</dt>
                    <dd>
                      {detail.businessProfile.industry} ·{" "}
                      {detail.businessProfile.businessSize.toLowerCase()}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-foreground-muted">City</dt>
                    <dd>{detail.businessProfile.city ?? "—"}</dd>
                  </div>
                  {detail.businessProfile.website ? (
                    <div>
                      <dt className="text-foreground-muted">Website</dt>
                      <dd className="break-all">{detail.businessProfile.website}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="text-foreground-muted">What they sell</dt>
                    <dd className="leading-relaxed">{detail.businessProfile.description}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-[13px] text-foreground-muted">Profile not filled in yet.</p>
              )}
            </Card>
            <Card title="Plan & settings">
              <dl className="grid gap-2 text-[12.5px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-foreground-muted">Plan</dt>
                  <dd>{detail.subscription?.plan.name ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-foreground-muted">Billing</dt>
                  <dd>
                    {detail.subscription && detail.subscription.billingProvider !== "none"
                      ? `${detail.subscription.billingProvider} · ${detail.subscription.status.toLowerCase()}${detail.subscription.cancelAtPeriodEnd ? ` · ends ${date(detail.subscription.currentPeriodEnd)}` : ""}`
                      : "Not paying"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-foreground-muted">Chains</dt>
                  <dd>
                    {detail.scoring.chainPolicy}
                    {detail.scoring.markedChains
                      ? ` · ${detail.scoring.markedChains} marked by hand`
                      : ""}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-foreground-muted">Learned model</dt>
                  <dd>
                    {detail.scoring.model
                      ? `AUC ${detail.scoring.model.auc?.toFixed(2) ?? "–"} · ${detail.scoring.model.samples} outcomes`
                      : "Not trained yet"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-foreground-muted">Currency / time zone</dt>
                  <dd>
                    {detail.currency} · {detail.timezone}
                  </dd>
                </div>
              </dl>
            </Card>
            <Card title={`Team (${detail.memberships.length})`}>
              <ul className="grid gap-2">
                {detail.memberships.map((member) => (
                  <li
                    key={member.user.email}
                    className="flex items-center justify-between gap-2 text-[12.5px]"
                  >
                    <span className="min-w-0 truncate">
                      {member.user.name}{" "}
                      <span className="text-foreground-muted">· {member.user.email}</span>
                    </span>
                    <Badge tone={member.role === "OWNER" ? "accent" : "neutral"}>
                      {member.role.toLowerCase()}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}
