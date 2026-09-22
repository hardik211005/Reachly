"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, CircleAlert, Copy, Download, FlaskConical, Lock, Plus, Send, Trash2, Webhook, Workflow as WorkflowIcon } from "lucide-react";
import { STEP_CATALOG, type WorkflowStep, type WorkflowTrigger } from "@repo/core/workflows/schemas";
import { WORKFLOW_TEMPLATES } from "@repo/core/workflows/templates";
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Label,
  SegmentedControl,
  Skeleton,
  Switch,
  Tooltip,
  cn,
  formatNumber,
  toast,
} from "@repo/ui";
import { PageHero } from "../page-hero";
import { api, apiWithMeta, errorMessage } from "@/lib/api-client";
import { useCanManage, useCanWrite } from "../shell/shell-context";
import { RelativeTime } from "../time";
import { pct } from "../outreach/shared";
import { RunSheet } from "./run-detail";
import { RunStatusBadge, StepGlyph, TRIGGER_ICONS, runDuration, triggerTitle } from "./shared";

interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  status: "DRAFT" | "ACTIVE" | "PAUSED";
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
  runs30d: number;
  failed30d: number;
  waiting: number;
  successRate: number | null;
  lastRunAt: string | null;
  updatedAt: string;
}

interface RunRow {
  id: string;
  status: string;
  triggerType: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  workflow: { id: string; name: string };
  lead: { id: string; name: string } | null;
  _count: { stepRuns: number };
}

type Tab = "workflows" | "runs" | "n8n" | "webhooks";

// ----------------------------------------------------------------------------- Pieces

function FlowPreview({ trigger, steps, max = 6 }: { trigger: WorkflowTrigger; steps: WorkflowStep[]; max?: number }) {
  const TriggerIcon = TRIGGER_ICONS[trigger.type];
  return (
    <div className="flex items-center gap-1">
      <Tooltip content={triggerTitle(trigger)}>
        <span className="flex size-6 items-center justify-center rounded-md bg-foreground text-background">
          <TriggerIcon className="size-3.5" />
        </span>
      </Tooltip>
      {steps.slice(0, max).map((step) => (
        <React.Fragment key={step.id}>
          <span aria-hidden className="h-px w-2 bg-border-strong" />
          <Tooltip content={STEP_CATALOG[step.type].label}>
            <span>
              <StepGlyph type={step.type} className="size-6 [&_svg]:size-3" />
            </span>
          </Tooltip>
        </React.Fragment>
      ))}
      {steps.length > max ? <span className="ml-1 text-[11px] text-foreground-muted">+{steps.length - max}</span> : null}
    </div>
  );
}

function StatusToggle({ workflow }: { workflow: WorkflowRow }) {
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const toggle = useMutation({
    mutationFn: (active: boolean) => api(`/api/v1/workflows/${workflow.id}/status`, { method: "POST", json: { status: active ? "ACTIVE" : "PAUSED" } }),
    onSuccess: (_, active) => {
      toast.success(active ? `“${workflow.name}” is live` : `“${workflow.name}” paused`);
      void queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Tooltip content={workflow.status === "ACTIVE" ? "Live — click to pause" : "Off — click to activate"}>
      <span onClick={(event) => event.stopPropagation()}>
        <Switch checked={workflow.status === "ACTIVE"} disabled={!canWrite || toggle.isPending} onCheckedChange={(value) => toggle.mutate(value)} aria-label={`Activate ${workflow.name}`} />
      </span>
    </Tooltip>
  );
}

function Templates({ onCreate, creating }: { onCreate: (template: string) => void; creating: string | null }) {
  const canWrite = useCanWrite();
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {WORKFLOW_TEMPLATES.map((template) => (
        <article key={template.key} className="flex flex-col rounded-lg border border-border bg-surface p-4 shadow-xs transition-colors hover:border-border-strong">
          <div className="flex items-center justify-between gap-2">
            <Badge tone="neutral">{template.category}</Badge>
            <FlowPreview trigger={template.definition.trigger as WorkflowTrigger} steps={(template.definition.steps ?? []) as WorkflowStep[]} max={4} />
          </div>
          <h3 className="mt-3 text-[13px] font-semibold">{template.definition.name}</h3>
          <p className="mt-1 flex-1 text-xs leading-relaxed text-foreground-muted">{template.definition.description}</p>
          {canWrite ? (
            <Button size="sm" variant="secondary" className="mt-3 self-start" onClick={() => onCreate(template.key)} disabled={creating !== null}>
              {creating === template.key ? "Creating…" : "Use template"}
            </Button>
          ) : null}
        </article>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------- Tabs

function WorkflowsTab({ onCreate, creating }: { onCreate: (template?: string) => void; creating: string | null }) {
  const router = useRouter();
  const canWrite = useCanWrite();
  const list = useQuery({ queryKey: ["workflows"], queryFn: () => api<WorkflowRow[]>("/api/v1/workflows"), refetchInterval: 20_000 });
  if (list.isPending) return <Skeleton className="h-64" />;
  if (list.isError) return <ErrorState description={errorMessage(list.error)} onRetry={() => void list.refetch()} />;
  const workflows = list.data;
  return (
    <div className="grid gap-6">
      {workflows.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
          {workflows.map((workflow) => (
            <li key={workflow.id}>
              <div
                role="link"
                tabIndex={0}
                onClick={() => router.push(`/app/workflows/${workflow.id}`)}
                onKeyDown={(event) => event.key === "Enter" && router.push(`/app/workflows/${workflow.id}`)}
                className="group grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-surface-muted/50 lg:grid-cols-[auto_minmax(0,1fr)_auto_repeat(2,76px)_104px_16px]"
              >
                <StatusToggle workflow={workflow} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold">{workflow.name}</span>
                    {workflow.status === "DRAFT" ? <Badge tone="neutral">Draft</Badge> : null}
                    {workflow.failed30d ? (
                      <Badge tone="danger">
                        <CircleAlert /> {workflow.failed30d} failed
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-foreground-muted">{workflow.description ?? triggerTitle(workflow.trigger)}</p>
                </div>
                <div className="hidden sm:block">
                  <FlowPreview trigger={workflow.trigger} steps={workflow.steps} />
                </div>
                <div className="hidden text-right lg:block">
                  <p className="text-[13px] font-medium tabular">{formatNumber(workflow.runs30d)}</p>
                  <p className="text-[11px] text-foreground-muted">Runs · 30d</p>
                </div>
                <div className="hidden text-right lg:block">
                  <p className="text-[13px] font-medium tabular">{pct(workflow.successRate)}</p>
                  <p className="text-[11px] text-foreground-muted">Succeeded</p>
                </div>
                <div className="hidden text-right lg:block">
                  <p className="text-[13px] font-medium whitespace-nowrap">{workflow.lastRunAt ? <RelativeTime value={workflow.lastRunAt} /> : "—"}</p>
                  <p className="text-[11px] text-foreground-muted">Last run</p>
                </div>
                <ArrowRight className="hidden size-4 text-foreground-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-foreground lg:block" />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-surface">
          <EmptyState
            icon={WorkflowIcon}
            title="No workflows yet"
            description="Automate what happens after a reply, a call or a new lead — start from a template below or build your own."
            action={
              canWrite ? (
                <Button size="sm" variant="primary" onClick={() => onCreate()} disabled={creating !== null}>
                  <Plus /> Blank workflow
                </Button>
              ) : null
            }
          />
        </div>
      )}
      <section className="grid gap-3">
        <div>
          <h2 className="text-sm font-semibold">Start from a template</h2>
          <p className="text-xs text-foreground-muted">Each one opens as a draft in the builder so you can check it, test it on a real lead and then switch it on.</p>
        </div>
        <Templates onCreate={(template) => onCreate(template)} creating={creating} />
      </section>
    </div>
  );
}

function RunsTab() {
  const [status, setStatus] = React.useState<string>("all");
  const [runId, setRunId] = React.useState<string | null>(null);
  const runs = useQuery({
    queryKey: ["workflow-runs", "all", status],
    queryFn: () => api<RunRow[]>(`/api/v1/workflows/executions?limit=50${status === "all" ? "" : `&status=${status}`}`),
    refetchInterval: 10_000,
  });
  return (
    <div className="grid gap-3">
      <SegmentedControl
        size="sm"
        value={status}
        onValueChange={setStatus}
        options={[
          { value: "all", label: "All" },
          { value: "COMPLETED", label: "Completed" },
          { value: "WAITING", label: "Waiting" },
          { value: "FAILED", label: "Failed" },
        ]}
      />
      {runs.isPending ? (
        <Skeleton className="h-64" />
      ) : runs.data?.length ? (
        <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface-muted/60 text-left text-xs text-foreground-muted">
                <th className="px-4 py-2 font-medium">Workflow</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">Lead</th>
                <th className="hidden px-3 py-2 font-medium lg:table-cell">Trigger</th>
                <th className="px-3 py-2 text-right font-medium">Duration</th>
                <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Started</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {runs.data.map((run) => (
                <tr key={run.id} onClick={() => setRunId(run.id)} className="cursor-pointer hover:bg-surface-muted/40">
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{run.workflow.name}</p>
                    {run.error ? <p className="max-w-xs truncate text-xs text-danger-text">{run.error}</p> : null}
                  </td>
                  <td className="px-3 py-2.5">
                    <RunStatusBadge status={run.status} />
                  </td>
                  <td className="hidden px-3 py-2.5 text-xs md:table-cell">{run.lead?.name ?? <span className="text-foreground-subtle">—</span>}</td>
                  <td className="hidden px-3 py-2.5 text-xs text-foreground-muted capitalize lg:table-cell">{run.triggerType}</td>
                  <td className="px-3 py-2.5 text-right text-xs tabular">{runDuration(run.startedAt, run.completedAt)}</td>
                  <td className="hidden px-3 py-2.5 text-right text-xs text-foreground-muted sm:table-cell">
                    <RelativeTime value={run.createdAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-surface">
          <EmptyState compact icon={WorkflowIcon} title="No runs" description="Every run of an active workflow shows up here with each step’s result." />
        </div>
      )}
      <RunSheet executionId={runId} onOpenChange={(open) => !open && setRunId(null)} />
    </div>
  );
}

interface N8nStatus {
  mode: "connected" | "platform" | "mock" | "not_configured";
  baseUrl: string | null;
  health: { ok: boolean; detail: string };
  workflows: Array<{ id: string; name: string; active: boolean; webhookPaths: string[]; updatedAt: string | null }>;
  listError: string | null;
  signed: boolean;
  callbackUrl: string;
  templates: ReadonlyArray<{ file: string; name: string; description: string; webhookPath: string | null }>;
}

function N8nTab() {
  const status = useQuery({ queryKey: ["n8n-status"], queryFn: () => api<N8nStatus>("/api/v1/workflows/n8n") });
  if (status.isPending) return <Skeleton className="h-64" />;
  if (status.isError) return <ErrorState description={errorMessage(status.error)} onRetry={() => void status.refetch()} />;
  const data = status.data;
  return (
    <div className="grid gap-4 *:min-w-0 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="grid content-start gap-4">
        <section className="rounded-lg border border-border bg-surface p-4 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-[13px] font-semibold">n8n connection</h3>
              <p className="text-xs text-foreground-muted">{data.baseUrl ?? (data.mode === "mock" ? "Demo mode — n8n steps are simulated" : "Not connected")}</p>
            </div>
            {data.mode === "mock" ? (
              <Badge tone="warning">
                <FlaskConical /> Demo
              </Badge>
            ) : data.health.ok ? (
              <Badge tone="success">
                <CheckCircle2 /> Reachable
              </Badge>
            ) : (
              <Badge tone="danger">
                <CircleAlert /> {data.mode === "not_configured" ? "Not connected" : "Unreachable"}
              </Badge>
            )}
          </div>
          {data.mode === "not_configured" || data.mode === "mock" ? (
            <p className="mt-3 text-xs leading-relaxed text-foreground-muted">
              Run n8n with <code className="font-mono">npm run infra:up</code> (it starts on :5678), then set <code className="font-mono">N8N_URL</code>, <code className="font-mono">N8N_API_KEY</code> and <code className="font-mono">N8N_WEBHOOK_SECRET</code>, or connect it in{" "}
              <Link href="/app/integrations" className="text-accent hover:underline">
                Integrations
              </Link>
              .
            </p>
          ) : null}
          {data.mode !== "mock" && data.mode !== "not_configured" && !data.signed ? (
            <Callout tone="warning" icon={CircleAlert} className="mt-3">
              Calls to n8n aren’t signed. Set a webhook secret so your n8n workflows can verify requests really come from ReachAI.
            </Callout>
          ) : null}
        </section>

        <section className="rounded-lg border border-border bg-surface shadow-xs">
          <header className="px-4 pt-3.5 pb-2">
            <h3 className="text-[13px] font-semibold">Templates for n8n</h3>
            <p className="text-xs text-foreground-muted">Import into n8n (Workflows → Import from file). Each verifies ReachAI’s signature before doing anything.</p>
          </header>
          <ul className="divide-y divide-border border-t border-border">
            {data.templates.map((template) => (
              <li key={template.file} className="flex items-start gap-3 px-4 py-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--series-7)_16%,transparent)] text-[var(--series-7)]">
                  <WorkflowIcon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{template.name}</p>
                  <p className="text-xs leading-relaxed text-foreground-muted">{template.description}</p>
                  {template.webhookPath ? <p className="mt-1 font-mono text-[11px] text-foreground-secondary">/webhook/{template.webhookPath}</p> : null}
                </div>
                <Button asChild size="sm" variant="secondary">
                  <a href={`/n8n/${template.file}`} download>
                    <Download /> JSON
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        </section>

        {data.workflows.length || data.listError ? (
          <section className="rounded-lg border border-border bg-surface shadow-xs">
            <header className="px-4 pt-3.5 pb-2">
              <h3 className="text-[13px] font-semibold">Workflows in your n8n</h3>
            </header>
            {data.listError ? (
              <p className="px-4 pb-4 text-xs text-danger-text">{data.listError}</p>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {data.workflows.map((workflow) => (
                  <li key={workflow.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                    <span className={cn("size-1.5 rounded-full", workflow.active ? "bg-good" : "bg-foreground-subtle")} />
                    <span className="min-w-0 flex-1 truncate">{workflow.name}</span>
                    <span className="font-mono text-[11px] text-foreground-muted">{workflow.webhookPaths.map((path) => `/webhook/${path}`).join(", ") || "no webhook"}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>

      <aside className="grid content-start gap-4">
        <section className="rounded-lg border border-border bg-surface p-4 shadow-xs">
          <h3 className="text-[13px] font-semibold">How ReachAI and n8n talk</h3>
          <ol className="mt-3 grid gap-3 text-xs leading-relaxed text-foreground-secondary">
            <li>
              <span className="font-medium text-foreground">ReachAI → n8n.</span> A “Run n8n workflow” step POSTs the lead, event and workflow to <code className="font-mono">/webhook/&lt;path&gt;</code>, signed with <code className="font-mono">x-reachai-signature</code>.
            </li>
            <li>
              <span className="font-medium text-foreground">n8n → ReachAI (callback).</span> If the step waits, n8n POSTs <code className="font-mono">{"{ token, status, data }"}</code> to:
              <span className="mt-1 flex items-center gap-1">
                <code className="min-w-0 flex-1 truncate rounded bg-surface-muted px-1.5 py-1 font-mono text-[10.5px]">{data.callbackUrl}</code>
                <Button size="icon-xs" variant="ghost" aria-label="Copy callback URL" onClick={() => void navigator.clipboard.writeText(data.callbackUrl).then(() => toast.success("Copied"))}>
                  <Copy />
                </Button>
              </span>
            </li>
            <li>
              <span className="font-medium text-foreground">n8n → ReachAI (start).</span> Give a workflow a <em>Webhook</em> trigger and n8n can start it with its URL, or use the REST API with an API key.
            </li>
          </ol>
        </section>
      </aside>
    </div>
  );
}

interface Endpoint {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  isActive: boolean;
  createdAt: string;
  recent: Array<{ id: string; eventType: string; status: string; responseCode: number | null; attempts: number; lastError: string | null; createdAt: string }>;
}

function WebhooksTab({ allowed }: { allowed: boolean }) {
  const queryClient = useQueryClient();
  const canManage = useCanManage();
  const [open, setOpen] = React.useState(false);
  const [url, setUrl] = React.useState("https://");
  const [events, setEvents] = React.useState<string[]>(["reply_classified", "meeting_created"]);
  const [secret, setSecret] = React.useState<string | null>(null);
  const list = useQuery({
    queryKey: ["webhook-endpoints"],
    queryFn: () => apiWithMeta<Endpoint[], { events: Array<{ type: string; label: string }> }>("/api/v1/webhook-endpoints"),
    enabled: canManage,
    refetchInterval: 15_000,
  });
  const create = useMutation({
    mutationFn: () => api<{ secret: string }>("/api/v1/webhook-endpoints", { method: "POST", json: { url, events } }),
    onSuccess: (result) => {
      setSecret(result.secret);
      void queryClient.invalidateQueries({ queryKey: ["webhook-endpoints"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/v1/webhook-endpoints/${id}`, { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["webhook-endpoints"] }),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const ping = useMutation({
    mutationFn: (id: string) => api(`/api/v1/webhook-endpoints/${id}/test`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Test event sent");
      window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["webhook-endpoints"] }), 1500);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!canManage) return <Callout tone="neutral">Only workspace admins can manage outbound webhooks.</Callout>;
  if (!allowed) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface">
        <EmptyState
          icon={Lock}
          title="Outbound webhooks are on the Scale plan"
          description="Send signed events (replies, meetings, deals…) to your own systems in real time. Workflows can still POST to any URL with a “Send webhook” step."
          action={
            <Button asChild size="sm" variant="secondary">
              <Link href="/app/billing">View plans</Link>
            </Button>
          }
        />
      </div>
    );
  }
  const available = list.data?.meta.events ?? [];
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-foreground-muted">Signed with <code className="font-mono">x-reachai-signature</code> and retried with backoff for about an hour.</p>
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            setSecret(null);
            setOpen(true);
          }}
        >
          <Plus /> Add endpoint
        </Button>
      </div>
      {list.isPending ? (
        <Skeleton className="h-40" />
      ) : list.data?.data.length ? (
        list.data.data.map((endpoint) => (
          <section key={endpoint.id} className="rounded-lg border border-border bg-surface shadow-xs">
            <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
              <Webhook className="size-4 text-foreground-muted" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{endpoint.url}</span>
              <Button size="xs" variant="ghost" onClick={() => ping.mutate(endpoint.id)}>
                <Send /> Send test
              </Button>
              <Button size="icon-xs" variant="ghost" aria-label="Delete endpoint" onClick={() => window.confirm("Delete this endpoint?") && remove.mutate(endpoint.id)}>
                <Trash2 />
              </Button>
            </header>
            <div className="flex flex-wrap gap-1 px-4 py-2.5">
              {endpoint.events.map((event) => (
                <Badge key={event} tone="outline">
                  {available.find((item) => item.type === event)?.label ?? event}
                </Badge>
              ))}
            </div>
            {endpoint.recent.length ? (
              <ul className="divide-y divide-border border-t border-border">
                {endpoint.recent.map((delivery) => (
                  <li key={delivery.id} className="flex items-center gap-2.5 px-4 py-2 text-xs">
                    <RunStatusBadge status={delivery.status === "SUCCEEDED" ? "COMPLETED" : delivery.status === "FAILED" ? "FAILED" : "WAITING"} />
                    <span className="min-w-0 flex-1 truncate">{delivery.eventType}</span>
                    <span className="text-foreground-muted tabular">{delivery.responseCode ?? "—"}</span>
                    <span className="text-foreground-muted">×{delivery.attempts}</span>
                    <RelativeTime value={delivery.createdAt} className="text-foreground-subtle" />
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-surface">
          <EmptyState compact icon={Webhook} title="No endpoints" description="Add an HTTPS endpoint to receive events as they happen." />
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{secret ? "Endpoint added" : "Add a webhook endpoint"}</DialogTitle>
            <DialogDescription>{secret ? "Copy the signing secret now — it won’t be shown again." : "We’ll POST signed JSON for each event you pick."}</DialogDescription>
          </DialogHeader>
          {secret ? (
            <div className="flex items-center gap-1.5">
              <Input readOnly value={secret} className="font-mono text-xs" aria-label="Signing secret" onFocus={(event) => event.target.select()} />
              <Button size="icon-sm" variant="secondary" aria-label="Copy secret" onClick={() => void navigator.clipboard.writeText(secret).then(() => toast.success("Copied"))}>
                <Copy />
              </Button>
            </div>
          ) : (
            <div className="grid gap-4">
              <Field>
                <Label htmlFor="endpoint-url">URL</Label>
                <Input id="endpoint-url" value={url} onChange={(event) => setUrl(event.target.value)} />
              </Field>
              <div className="grid gap-1.5">
                <Label>Events</Label>
                <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
                  {available.map((event) => (
                    <label key={event.type} className="flex items-center gap-2 rounded-sm px-1.5 py-1 text-xs hover:bg-surface-muted">
                      <Checkbox checked={events.includes(event.type)} onCheckedChange={(value) => setEvents(value === true ? [...events, event.type] : events.filter((item) => item !== event.type))} />
                      {event.label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            {secret ? (
              <Button size="sm" variant="primary" onClick={() => setOpen(false)}>
                Done
              </Button>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" variant="primary" disabled={!events.length || create.isPending} onClick={() => create.mutate()}>
                  Add endpoint
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ----------------------------------------------------------------------------- Page

export function WorkflowsView({ plan }: { plan: { workflows: boolean; outboundWebhooks: boolean; limit: number | null; name: string } }) {
  const router = useRouter();
  const canWrite = useCanWrite();
  const [tab, setTab] = React.useState<Tab>("workflows");
  const [creating, setCreating] = React.useState<string | null>(null);
  const create = useMutation({
    mutationFn: (template?: string) =>
      api<{ id: string }>("/api/v1/workflows", { method: "POST", json: template ? { template } : { name: "Untitled workflow", trigger: { type: "event", eventType: "reply_classified", conditions: [] }, steps: [] } }),
    onMutate: (template) => setCreating(template ?? "blank"),
    onSuccess: (workflow) => router.push(`/app/workflows/${workflow.id}`),
    onError: (error) => {
      setCreating(null);
      toast.error(errorMessage(error));
    },
  });

  return (
    <div className="grid gap-5">
      <PageHero
        title="Workflows"
        highlight="Workflows"
        description="Automations that react to replies, calls and new leads — built on the same rules as everything else, with every run logged step by step."
        actions={
          canWrite && plan.workflows ? (
            <Button size="sm" variant="primary" onClick={() => create.mutate(undefined)} disabled={creating !== null}>
              <Plus /> New workflow
            </Button>
          ) : null
        }
      />
      {!plan.workflows ? (
        <Callout tone="accent" icon={Lock} action={<Link href="/app/billing" className="text-xs font-medium text-accent hover:underline">View plans</Link>}>
          Workflows aren’t included in the {plan.name} plan. You can browse templates; activating automations needs Pro or Scale.
        </Callout>
      ) : null}
      <SegmentedControl
        size="sm"
        value={tab}
        onValueChange={setTab}
        options={[
          { value: "workflows", label: "Workflows" },
          { value: "runs", label: "Runs" },
          { value: "n8n", label: "n8n" },
          { value: "webhooks", label: "Outbound webhooks" },
        ]}
      />
      {tab === "workflows" ? <WorkflowsTab onCreate={(template) => create.mutate(template)} creating={creating} /> : null}
      {tab === "runs" ? <RunsTab /> : null}
      {tab === "n8n" ? <N8nTab /> : null}
      {tab === "webhooks" ? <WebhooksTab allowed={plan.outboundWebhooks} /> : null}
    </div>
  );
}
