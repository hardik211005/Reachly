"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleDashed, CircleX, FlaskConical, Hourglass, RotateCcw, SkipForward } from "lucide-react";
import { STEP_CATALOG, type WorkflowStep } from "@repo/core/workflows/schemas";
import { Button, Callout, ErrorState, Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle, Skeleton, cn, toast } from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { useCanWrite } from "../shell/shell-context";
import { LocalTime, RelativeTime } from "../time";
import { RunStatusBadge, StepGlyph, runDuration, stepSummary } from "./shared";

export interface StepRun {
  id: string;
  stepId: string;
  stepType: string;
  stepIndex: number;
  status: string;
  output: Record<string, unknown> | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface ExecutionDetail {
  id: string;
  status: string;
  triggerType: string;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  resumeAt: string | null;
  createdAt: string;
  workflow: { id: string; name: string };
  lead: { id: string; name: string } | null;
  definition: WorkflowStep[];
  dryRun: boolean;
  stoppedReason: string | null;
  stepRuns: StepRun[];
}

/** One-line human description of what a step run did (or would do, in a test). */
export function outcomeText(run: StepRun | undefined): { tone: "done" | "skipped" | "stopped" | "failed" | "waiting" | "pending"; text: string } {
  if (!run) return { tone: "pending", text: "Not reached" };
  if (run.status === "FAILED") return { tone: "failed", text: run.error ?? "Failed" };
  if (run.status === "WAITING") return { tone: "waiting", text: "Waiting for n8n to call back" };
  if (run.status === "RUNNING") return { tone: "waiting", text: "Running…" };
  const output = run.output ?? {};
  if (typeof output.skipped === "string") return { tone: "skipped", text: `Skipped — ${output.skipped}` };
  if (output.passed === false) return { tone: "stopped", text: "Conditions not met — stopped here" };
  if (output.passed === true) return { tone: "done", text: "Conditions met" };
  const would = Object.entries(output).find(([key]) => key.startsWith("would"));
  if (would) {
    const labels: Record<string, string> = {
      wouldWaitUntil: "Would wait until",
      wouldChange: "Would change status",
      wouldAdd: "Would add tag",
      wouldMoveDeal: "Would move the deal (forward only) to",
      wouldCreate: "Would create task",
      wouldAddTo: "Would add to campaign",
      wouldStop: "Would stop sequences",
      wouldNotify: "Would notify",
      wouldSend: "Would email",
      wouldPrepare: "Would prepare a call",
      wouldPost: "Would POST to",
      wouldTrigger: "Would trigger n8n webhook",
    };
    const value = would[0] === "wouldWaitUntil" ? new Date(String(would[1])).toLocaleString() : String(would[1]);
    return { tone: "done", text: `${labels[would[0]] ?? would[0]}: ${value}` };
  }
  if (typeof output.resumeAt === "string") return { tone: "waiting", text: `Waiting until ${new Date(output.resumeAt).toLocaleString()}` };
  if (typeof output.title === "string") return { tone: "done", text: `Done — ${output.title}` };
  if (typeof output.to === "string") return { tone: "done", text: `Status ${String(output.from)} → ${output.to}` };
  if (typeof output.tag === "string") return { tone: "done", text: `Tagged #${output.tag}` };
  if (typeof output.dealId === "string") return { tone: "done", text: `Deal is at ${String(output.stage ?? "").toLowerCase()}` };
  if (typeof output.status === "number") return { tone: "done", text: `HTTP ${output.status}${output.simulated ? " (demo n8n — simulated)" : ""}` };
  if (typeof output.campaign === "string") return { tone: "done", text: `${output.added ? "Added to" : "Not added to"} ${output.campaign}` };
  return { tone: "done", text: "Done" };
}

export const OUTCOME_ICON = { done: CircleCheck, skipped: SkipForward, stopped: CircleDashed, failed: CircleX, waiting: Hourglass, pending: CircleDashed };
export const OUTCOME_COLOR = {
  done: "text-success-text",
  skipped: "text-foreground-muted",
  stopped: "text-warning-text",
  failed: "text-danger-text",
  waiting: "text-warning-text",
  pending: "text-foreground-subtle",
};

export function RunTimeline({ run }: { run: ExecutionDetail }) {
  return (
    <ol className="grid gap-0">
      {run.definition.map((step, index) => {
        const stepRun = [...run.stepRuns].reverse().find((item) => item.stepId === step.id);
        const outcome = outcomeText(stepRun);
        const Icon = OUTCOME_ICON[outcome.tone];
        return (
          <li key={step.id} className="relative flex gap-3 pb-4 last:pb-0">
            {index < run.definition.length - 1 ? <span aria-hidden className="absolute top-9 bottom-0 left-4 w-px bg-border" /> : null}
            <StepGlyph type={step.type} />
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-[13px] font-medium">{STEP_CATALOG[step.type].label}</p>
              <p className="truncate text-xs text-foreground-muted">{stepSummary(step)}</p>
              <p className={cn("mt-1 flex items-start gap-1.5 text-xs", OUTCOME_COLOR[outcome.tone])}>
                <Icon className="mt-0.5 size-3.5 shrink-0" /> <span className="break-words">{outcome.text}</span>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function RunSheet({ executionId, onOpenChange }: { executionId: string | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const query = useQuery({
    queryKey: ["workflow-run", executionId],
    queryFn: () => api<ExecutionDetail>(`/api/v1/workflows/executions/${executionId}`),
    enabled: Boolean(executionId),
    refetchInterval: (state) => (state.state.data && ["PENDING", "RUNNING"].includes(state.state.data.status) ? 2_000 : false),
  });
  const retry = useMutation({
    mutationFn: () => api(`/api/v1/workflows/executions/${executionId}/retry`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Retrying from the failed step");
      void queryClient.invalidateQueries({ queryKey: ["workflow-run", executionId] });
      void queryClient.invalidateQueries({ queryKey: ["workflow-runs"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const cancel = useMutation({
    mutationFn: () => api(`/api/v1/workflows/executions/${executionId}/cancel`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Run canceled");
      void queryClient.invalidateQueries({ queryKey: ["workflow-run", executionId] });
      void queryClient.invalidateQueries({ queryKey: ["workflow-runs"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const run = query.data;
  return (
    <Sheet open={Boolean(executionId)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{run?.workflow.name ?? "Run"}</SheetTitle>
          <SheetDescription>{run ? <>Started <RelativeTime value={run.createdAt} /> · {run.triggerType === "test" ? "test run" : `${run.triggerType} trigger`}</> : "Loading…"}</SheetDescription>
        </SheetHeader>
        <SheetBody className="grid content-start gap-4">
          {query.isPending ? (
            <Skeleton className="h-64" />
          ) : query.isError || !run ? (
            <ErrorState description={errorMessage(query.error)} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
                <RunStatusBadge status={run.status} />
                {run.lead ? (
                  <Link href={`/app/leads/${run.lead.id}`} className="font-medium text-foreground hover:underline">
                    {run.lead.name}
                  </Link>
                ) : null}
                <span>{runDuration(run.startedAt, run.completedAt)}</span>
                {run.completedAt ? <LocalTime value={run.completedAt} /> : null}
              </div>
              {run.dryRun ? (
                <Callout tone="neutral" icon={FlaskConical}>
                  Test run — nothing was changed. Each step shows what it would have done.
                </Callout>
              ) : null}
              {run.status === "WAITING" && run.resumeAt ? (
                <Callout tone="warning" icon={Hourglass}>
                  Waiting — continues <RelativeTime value={run.resumeAt} />.
                </Callout>
              ) : null}
              {run.error ? (
                <Callout tone="danger" icon={CircleX} title="This run failed">
                  {run.error}
                </Callout>
              ) : null}
              {run.stoppedReason && run.status === "COMPLETED" ? <p className="text-xs text-foreground-muted">Stopped early: {run.stoppedReason.toLowerCase()}.</p> : null}
              <RunTimeline run={run} />
              {canWrite && (run.status === "FAILED" || ["PENDING", "WAITING"].includes(run.status)) ? (
                <div className="flex justify-end gap-2 border-t border-border pt-3">
                  {["PENDING", "WAITING"].includes(run.status) ? (
                    <Button size="sm" variant="ghost" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
                      Cancel run
                    </Button>
                  ) : null}
                  {run.status === "FAILED" && !run.dryRun ? (
                    <Button size="sm" variant="primary" onClick={() => retry.mutate()} disabled={retry.isPending}>
                      <RotateCcw /> Retry from failed step
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
