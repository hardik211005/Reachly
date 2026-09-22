"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, CheckCircle2, Cpu, Database, Layers, RefreshCw, Server, XCircle } from "lucide-react";
import { motion } from "motion/react";
import { Badge, Button, EmptyState, ErrorState, Skeleton, Stagger, StaggerItem, StatusBadge, cn } from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { PageHero } from "../page-hero";

type State = "ok" | "degraded" | "down" | "not_applicable";
interface Health {
  checkedAt: string;
  overall: State;
  checks: Array<{ key: string; label: string; state: State; detail: string; latencyMs?: number }>;
  queue: { driver: "bullmq" | "inline"; stats: Array<{ queue: string; waiting: number; active: number; delayed: number; completed: number; failed: number }> };
  workers: Array<{ id: string; at: string; queues: string[] }>;
  failedJobs: Array<{ name: string; error: string; failedAt: string; attempts?: number }>;
  failures: { workflows: number; webhookDeliveries: number; messages: number; inboundWebhooks: number };
  providers: Array<{ category: string; label: string; mode: string; provider: string | null }>;
  runtime: { environment: string; demoMode: boolean; node: string; uptimeSeconds: number };
}

const STATE = {
  ok: { label: "All systems normal", short: "Healthy", icon: CheckCircle2, color: "text-good", ring: "bg-good", tone: "success" as const },
  degraded: { label: "Some things need attention", short: "Degraded", icon: AlertTriangle, color: "text-warning-text", ring: "bg-warning", tone: "warning" as const },
  down: { label: "Something is down", short: "Down", icon: XCircle, color: "text-danger-text", ring: "bg-critical", tone: "danger" as const },
  not_applicable: { label: "Not applicable", short: "N/A", icon: CheckCircle2, color: "text-foreground-muted", ring: "bg-foreground-subtle", tone: "muted" as const },
};
const CHECK_ICON: Record<string, React.ComponentType<{ className?: string }>> = { database: Database, redis: Server, workers: Cpu, queue: Layers, ai: Activity, failures: AlertTriangle };

function uptime(seconds: number) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function ago(value: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  return seconds < 60 ? `${seconds}s ago` : seconds < 3600 ? `${Math.round(seconds / 60)}m ago` : new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function SystemView() {
  const health = useQuery({ queryKey: ["system-health"], queryFn: () => api<Health>("/api/v1/system/health"), refetchInterval: 30_000 });
  const data = health.data;
  const overall = STATE[data?.overall ?? "ok"];
  return (
    <div className="grid gap-6">
      <PageHero
        title="System health"
        highlight="health"
        description="Live checks for the database, job queue and workers, plus anything that failed in this workspace recently."
        actions={
          <Button variant="secondary" size="sm" onClick={() => void health.refetch()} disabled={health.isFetching}>
            <RefreshCw className={cn(health.isFetching && "animate-spin")} /> Refresh
          </Button>
        }
      />
      {health.isError ? (
        <ErrorState description={errorMessage(health.error)} onRetry={() => void health.refetch()} />
      ) : !data ? (
        <Skeleton className="h-[480px] rounded-xl" />
      ) : (
        <>
          <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-surface p-5 shadow-xs" aria-live="polite">
            <span className="relative flex size-4">
              <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-50", overall.ring)} />
              <span className={cn("relative inline-flex size-4 rounded-full", overall.ring)} />
            </span>
            <div className="flex-1">
              <p className="text-[17px] font-semibold">{overall.label}</p>
              <p className="text-[12.5px] text-foreground-muted">Checked {ago(data.checkedAt)} · refreshes every 30 seconds</p>
            </div>
            <div className="flex flex-wrap gap-2 text-[12px]">
              <Badge tone="outline">{data.runtime.environment}</Badge>
              {data.runtime.demoMode ? <Badge tone="warning">Demo mode</Badge> : null}
              <Badge tone="outline">Node {data.runtime.node}</Badge>
              <Badge tone="outline">Up {uptime(data.runtime.uptimeSeconds)}</Badge>
            </div>
          </motion.section>

          <Stagger className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.checks.map((check) => {
              const state = STATE[check.state];
              const Icon = CHECK_ICON[check.key] ?? Activity;
              return (
                <StaggerItem key={check.key}>
                  <div className="flex h-full gap-3 rounded-xl border border-border bg-surface p-4">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted">
                      <Icon className="size-4 text-foreground-muted" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[13.5px] font-semibold">{check.label}</p>
                        <StatusBadge tone={state.tone}>{state.short}</StatusBadge>
                      </div>
                      <p className="mt-0.5 text-[12.5px] text-foreground-muted">{check.detail}</p>
                      {check.latencyMs !== undefined ? <p className="mt-1 text-[11.5px] text-foreground-subtle tabular">{check.latencyMs} ms</p> : null}
                    </div>
                  </div>
                </StaggerItem>
              );
            })}
          </Stagger>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
              <header className="flex items-center justify-between border-b border-border px-5 py-3.5">
                <h2 className="flex items-center gap-2 text-[14px] font-semibold">
                  <Layers className="size-4 text-foreground-muted" /> Job queues
                </h2>
                <Badge tone="outline">{data.queue.driver === "inline" ? "Inline (in web process)" : "BullMQ + Redis"}</Badge>
              </header>
              {data.queue.stats.length === 0 ? (
                <EmptyState compact icon={Layers} title="No jobs yet" description="Queues appear once jobs have run." />
              ) : (
                <table className="w-full text-left text-[12.5px]">
                  <thead className="bg-surface-muted/60 text-[11px] text-foreground-muted">
                    <tr>
                      <th className="px-5 py-2 font-medium">Queue</th>
                      <th className="px-3 py-2 text-right font-medium">Waiting</th>
                      <th className="px-3 py-2 text-right font-medium">Active</th>
                      <th className="px-3 py-2 text-right font-medium">Delayed</th>
                      <th className="px-3 py-2 text-right font-medium">Done</th>
                      <th className="px-5 py-2 text-right font-medium">Failed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border tabular">
                    {data.queue.stats.map((row) => (
                      <tr key={row.queue}>
                        <td className="px-5 py-2 font-medium">{row.queue}</td>
                        <td className="px-3 py-2 text-right">{row.waiting}</td>
                        <td className="px-3 py-2 text-right">{row.active}</td>
                        <td className="px-3 py-2 text-right">{row.delayed}</td>
                        <td className="px-3 py-2 text-right text-foreground-muted">{row.completed}</td>
                        <td className={cn("px-5 py-2 text-right", row.failed ? "font-semibold text-danger-text" : "text-foreground-muted")}>{row.failed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {data.queue.driver === "bullmq" ? (
                <div className="border-t border-border px-5 py-3">
                  <p className="text-[12px] font-medium text-foreground-secondary">Workers</p>
                  {data.workers.length ? (
                    <ul className="mt-1.5 grid gap-1">
                      {data.workers.map((worker) => (
                        <li key={worker.id} className="flex items-center gap-2 text-[12px] text-foreground-muted">
                          <span className="size-1.5 rounded-full bg-good" /> <span className="font-mono">{worker.id}</span> · {worker.queues.length} queues · seen {ago(worker.at)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-[12px] text-danger-text">No workers reporting.</p>
                  )}
                </div>
              ) : null}
            </section>

            <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
              <header className="border-b border-border px-5 py-3.5">
                <h2 className="flex items-center gap-2 text-[14px] font-semibold">
                  <AlertTriangle className="size-4 text-foreground-muted" /> Failures in this workspace · last 24 hours
                </h2>
              </header>
              <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
                {[
                  ["Workflow runs", data.failures.workflows],
                  ["Messages", data.failures.messages],
                  ["Webhook deliveries", data.failures.webhookDeliveries],
                  ["Inbound webhooks", data.failures.inboundWebhooks],
                ].map(([label, value]) => (
                  <div key={label} className="bg-surface px-4 py-3">
                    <p className={cn("text-[20px] font-semibold tabular", Number(value) ? "text-danger-text" : "")}>{value}</p>
                    <p className="text-[11.5px] text-foreground-muted">{label}</p>
                  </div>
                ))}
              </div>
              <div className="border-t border-border px-5 py-3">
                <p className="text-[12px] font-medium text-foreground-secondary">Background jobs that gave up</p>
                {data.failedJobs.length === 0 ? (
                  <p className="mt-1 text-[12px] text-foreground-muted">None — every job finished or is still retrying.</p>
                ) : (
                  <ul className="mt-2 grid max-h-64 gap-2 overflow-y-auto">
                    {data.failedJobs.map((job, index) => (
                      <li key={`${job.name}-${job.failedAt}-${index}`} className="rounded-lg bg-danger-soft/60 px-3 py-2">
                        <p className="flex items-center justify-between gap-2 text-[12px] font-medium">
                          <span className="font-mono">{job.name}</span>
                          <span className="font-normal text-foreground-muted">{ago(job.failedAt)}</span>
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-[11.5px] text-danger-text">{job.error}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>

          <section className="rounded-xl border border-border bg-surface p-5 shadow-xs">
            <h2 className="text-[14px] font-semibold">Providers in use</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {data.providers.map((provider) => (
                <StatusBadge key={provider.category} tone={provider.mode === "connected" || provider.mode === "platform" ? "success" : provider.mode === "mock" ? "warning" : "muted"}>
                  {provider.label}: {provider.mode === "mock" ? "simulated" : provider.mode === "not_configured" ? "not set up" : provider.provider}
                </StatusBadge>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
