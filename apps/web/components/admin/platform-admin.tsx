"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, CircleDollarSign, RotateCcw, Search, UserPlus, Users, Zap } from "lucide-react";
import {
  AnimatedNumber,
  Badge,
  Button,
  Input,
  Reveal,
  SegmentedControl,
  Spinner,
  Stagger,
  StaggerItem,
  formatCurrency,
  toast,
} from "@repo/ui";
import {
  PlatformOverview,
  type ActivityDay,
  type FeedItem,
  type PlatformHealth,
} from "./platform-overview";
import { api, errorMessage } from "@/lib/api-client";

interface Overview {
  generatedAt: string;
  totals: {
    users: number;
    newUsersWeek: number;
    newUsersMonth: number;
    workspaces: number;
    deletedWorkspaces: number;
    leads: number;
    eventsWeek: number;
    payingWorkspaces: number;
    revenue: Record<string, number>;
  };
  plans: Array<{ key: string; name: string; workspaces: number; paying: number }>;
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    createdAt: string;
    deletedAt: string | null;
    onboardingCompleted: boolean;
    owner: string | null;
    members: number;
    plan: string;
    billing: {
      provider: string;
      status: string;
      cancelAtPeriodEnd: boolean;
      currentPeriodEnd: string;
    } | null;
    leads: number;
    lastActivityAt: string | null;
  }>;
  users: Array<{
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    createdAt: string;
    lastSeenAt: string | null;
    workspaces: Array<{ name: string; role: string }>;
    platformAdmin: boolean;
  }>;
}

// Fixed locale and time zone, so the server-rendered text matches the browser exactly. Workspaces
// span time zones, so this cross-tenant view uses UTC.
const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const date = (value: string | null) => (value ? DATE_FORMAT.format(new Date(value)) : "—");
const count = (value: number) => Math.round(value).toLocaleString("en-IN");

/** "3 days ago", measured from when the server took the snapshot so both renders agree. */
function Ago({ value, now }: { value: string | null; now: string }) {
  if (!value) return <>never</>;
  const days = Math.floor((new Date(now).getTime() - new Date(value).getTime()) / 86_400_000);
  return (
    <time dateTime={value} title={value}>
      {days <= 0
        ? "today"
        : days === 1
          ? "yesterday"
          : days < 30
            ? `${days} days ago`
            : date(value)}
    </time>
  );
}
const PURGE_DAYS = 30;

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-xs">
      <div className="flex items-center gap-2 text-[12px] text-foreground-muted">
        <Icon className="size-3.5" /> {label}
      </div>
      <p className="mt-2 font-heading text-[26px] leading-none font-semibold tabular-nums">
        {value}
      </p>
      {hint ? <p className="mt-1.5 text-[11.5px] text-foreground-subtle">{hint}</p> : null}
    </div>
  );
}

function RestoreButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  return (
    <Button
      variant="secondary"
      size="xs"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await api(`/api/admin/workspaces/${id}/restore`, { method: "POST" });
          toast.success(`Restored “${name}”`);
          router.refresh();
        } catch (error) {
          toast.error(errorMessage(error));
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? <Spinner className="size-3" /> : <RotateCcw />} Restore
    </Button>
  );
}

export function PlatformAdmin({
  overview,
  activity,
  feed,
  health,
}: {
  overview: Overview;
  activity: ActivityDay[];
  feed: FeedItem[];
  health: PlatformHealth;
}) {
  const [tab, setTab] = React.useState<"overview" | "workspaces" | "users">("overview");
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const workspaces = overview.workspaces.filter(
    (item) =>
      !q || [item.name, item.slug, item.owner ?? "", item.plan].join(" ").toLowerCase().includes(q),
  );
  const users = overview.users.filter(
    (item) =>
      !q ||
      [item.name, item.email, ...item.workspaces.map((w) => w.name)]
        .join(" ")
        .toLowerCase()
        .includes(q),
  );
  const revenue = Object.entries(overview.totals.revenue);

  return (
    <main>
      <div className="mx-auto grid max-w-[1400px] gap-6 px-4 py-6 sm:px-6">
        <Reveal y={10}>
          <h1 className="font-heading text-[28px] font-semibold tracking-[-0.03em]">
            Everything on this deployment
          </h1>
          <p className="mt-1 text-[13.5px] text-foreground-secondary">
            Every workspace and user across all customers. Businesses only ever see their own data —
            this portal is only for whoever runs Reachly.
          </p>
        </Reveal>

        <Stagger className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StaggerItem>
            <Stat
              icon={Users}
              label="Users"
              value={<AnimatedNumber value={overview.totals.users} />}
              hint={`${overview.totals.newUsersWeek} new this week · ${overview.totals.newUsersMonth} in 30 days`}
            />
          </StaggerItem>
          <StaggerItem>
            <Stat
              icon={Building2}
              label="Workspaces"
              value={<AnimatedNumber value={overview.totals.workspaces} />}
              hint={
                overview.totals.deletedWorkspaces
                  ? `${overview.totals.deletedWorkspaces} deleted, awaiting purge`
                  : "None deleted"
              }
            />
          </StaggerItem>
          <StaggerItem>
            <Stat
              icon={CircleDollarSign}
              label="Paying workspaces"
              value={<AnimatedNumber value={overview.totals.payingWorkspaces} />}
              hint={
                revenue.length
                  ? `${revenue.map(([currency, amount]) => formatCurrency(amount / 100, currency)).join(" + ")} / month`
                  : "No paid subscriptions yet"
              }
            />
          </StaggerItem>
          <StaggerItem>
            <Stat
              icon={UserPlus}
              label="Leads stored"
              value={<AnimatedNumber value={overview.totals.leads} format={count} />}
            />
          </StaggerItem>
          <StaggerItem>
            <Stat
              icon={Zap}
              label="Activity (7 days)"
              value={<AnimatedNumber value={overview.totals.eventsWeek} format={count} />}
              hint="Events recorded across all workspaces"
            />
          </StaggerItem>
        </Stagger>

        {overview.plans.length ? (
          <div className="flex flex-wrap gap-2 text-[12.5px]">
            {overview.plans.map((plan) => (
              <span
                key={plan.key}
                className="rounded-full border border-border bg-surface px-3 py-1 text-foreground-secondary"
              >
                <span className="font-semibold text-foreground">{plan.name}</span> ·{" "}
                {plan.workspaces} workspace{plan.workspaces === 1 ? "" : "s"}
                {plan.paying ? ` · ${plan.paying} paying` : ""}
              </span>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            value={tab}
            onValueChange={(value) => setTab(value as "overview" | "workspaces" | "users")}
            options={[
              { value: "overview", label: "Overview" },
              { value: "workspaces", label: `Workspaces (${overview.workspaces.length})` },
              { value: "users", label: `Users (${overview.users.length})` },
            ]}
          />
          {tab === "overview" ? null : (
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-foreground-muted" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={
                  tab === "workspaces"
                    ? "Search name, owner, plan…"
                    : "Search name, email, workspace…"
                }
                className="pl-8"
                aria-label="Search"
              />
            </div>
          )}
        </div>

        {tab === "overview" ? (
          <PlatformOverview
            activity={activity}
            feed={feed}
            health={health}
            now={overview.generatedAt}
          />
        ) : null}

        {tab === "overview" ? null : (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-xs">
            {tab === "workspaces" ? (
              <table className="w-full min-w-[900px] text-left text-[13px]">
                <thead className="bg-surface-muted/60 text-[11.5px] text-foreground-muted">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Workspace</th>
                    <th className="px-4 py-2.5 font-medium">Owner</th>
                    <th className="px-4 py-2.5 font-medium">Plan</th>
                    <th className="px-4 py-2.5 text-right font-medium">Members</th>
                    <th className="px-4 py-2.5 text-right font-medium">Leads</th>
                    <th className="px-4 py-2.5 font-medium">Last active</th>
                    <th className="px-4 py-2.5 font-medium">Created</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {workspaces.map((item) => {
                    const purgeOn = item.deletedAt
                      ? new Date(
                          new Date(item.deletedAt).getTime() + PURGE_DAYS * 86_400_000,
                        ).toISOString()
                      : null;
                    return (
                      <tr
                        key={item.id}
                        className={item.deletedAt ? "bg-danger-soft/30" : undefined}
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/admin/workspaces/${item.id}`}
                            className="font-medium underline-offset-2 hover:underline"
                          >
                            {item.name}
                          </Link>
                          <p className="font-mono text-[11px] text-foreground-subtle">
                            {item.slug}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {item.deletedAt ? (
                              <Badge tone="danger">Deleted · purged {date(purgeOn)}</Badge>
                            ) : null}
                            {!item.onboardingCompleted && !item.deletedAt ? (
                              <Badge tone="warning">Onboarding</Badge>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-foreground-secondary">{item.owner ?? "—"}</td>
                        <td className="px-4 py-3">
                          <p>{item.plan}</p>
                          {item.billing && item.billing.provider !== "none" ? (
                            <p className="text-[11.5px] text-foreground-muted">
                              {item.billing.provider} · {item.billing.status.toLowerCase()}
                              {item.billing.cancelAtPeriodEnd
                                ? ` · ends ${date(item.billing.currentPeriodEnd)}`
                                : ""}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{item.members}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{count(item.leads)}</td>
                        <td className="px-4 py-3 text-foreground-secondary">
                          <Ago value={item.lastActivityAt} now={overview.generatedAt} />
                        </td>
                        <td className="px-4 py-3 text-foreground-secondary">
                          {date(item.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {item.deletedAt ? <RestoreButton id={item.id} name={item.name} /> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <table className="w-full min-w-[820px] text-left text-[13px]">
                <thead className="bg-surface-muted/60 text-[11.5px] text-foreground-muted">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">User</th>
                    <th className="px-4 py-2.5 font-medium">Workspaces</th>
                    <th className="px-4 py-2.5 font-medium">Email</th>
                    <th className="px-4 py-2.5 font-medium">Last seen</th>
                    <th className="px-4 py-2.5 font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {users.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-3">
                        <p className="flex items-center gap-1.5 font-medium">
                          {item.name || "—"}
                          {item.platformAdmin ? <Badge tone="danger">Admin</Badge> : null}
                        </p>
                        <p className="text-[12px] text-foreground-muted">{item.email}</p>
                      </td>
                      <td className="px-4 py-3 text-foreground-secondary">
                        {item.workspaces.length ? (
                          item.workspaces
                            .map((w) => `${w.name} (${w.role.toLowerCase()})`)
                            .join(", ")
                        ) : (
                          <span className="text-warning-text">None yet</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {item.emailVerified ? (
                          <Badge tone="success">Verified</Badge>
                        ) : (
                          <Badge>Unverified</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-foreground-secondary">
                        <Ago value={item.lastSeenAt} now={overview.generatedAt} />
                      </td>
                      <td className="px-4 py-3 text-foreground-secondary">
                        {date(item.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {(tab === "workspaces" ? workspaces : users).length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-foreground-muted">
                Nothing matches “{query}”.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}
