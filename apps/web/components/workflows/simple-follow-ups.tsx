"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  CalendarClock,
  Flame,
  HeartHandshake,
  MessageSquareReply,
  PhoneCall,
  Star,
} from "lucide-react";
import { Badge, Spinner, Switch, cn, toast } from "@repo/ui";
import { getTemplate } from "@repo/core/workflows/templates";
import { api, errorMessage } from "@/lib/api-client";
import { useCanWrite } from "../shell/shell-context";

interface WorkflowLite {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "DRAFT";
  runs30d: number;
}

/** Ready-made follow-ups, each a plain sentence an owner can switch on — no builder needed. */
const RECIPES = [
  {
    key: "positive-reply-follow-up",
    icon: MessageSquareReply,
    when: "When someone replies interested",
    then: "mark them as interested and remind me to reply the same day.",
  },
  {
    key: "callback-requested",
    icon: PhoneCall,
    when: "When someone asks me to call back later",
    then: "add a call reminder for 3 days later.",
  },
  {
    key: "not-now-nurture",
    icon: CalendarClock,
    when: "When someone says “not now”",
    then: "stop messaging them and check back by email after 30 days (you approve it first).",
  },
  {
    key: "high-fit-to-campaign",
    icon: Flame,
    when: "When a great-fit business is found",
    then: "tag it “hot” and get a call ready for me with talking points.",
  },
  {
    key: "opt-out-alert",
    icon: Ban,
    when: "When someone asks not to be contacted",
    then: "tell me — they're never messaged again.",
  },
] as const;

interface PageSettings {
  enabled: boolean;
  headline: string | null;
  about: string | null;
  showPrices: boolean;
  acceptEnquiries: boolean;
  afterWinFollowUps: boolean;
}

function Row({
  icon: Icon,
  when,
  then,
  on,
  busy,
  disabled,
  onChange,
  note,
}: {
  icon: React.ComponentType<{ className?: string }>;
  when: string;
  then: string;
  on: boolean;
  busy: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
  note?: React.ReactNode;
}) {
  return (
    <li className={cn("flex items-start gap-3 px-4 py-3.5", on && "bg-success-soft/25")}>
      <span
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
          on ? "bg-success-soft text-success-text" : "bg-surface-muted text-foreground-muted",
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] leading-snug">
          <span className="font-semibold">{when}</span>, {then}
        </p>
        {note ? <p className="mt-0.5 text-[12px] text-foreground-muted">{note}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        {busy ? <Spinner className="size-3.5" /> : null}
        <Switch
          checked={on}
          disabled={disabled || busy}
          onCheckedChange={onChange}
          aria-label={`${when}, ${then}`}
        />
      </div>
    </li>
  );
}

export function SimpleFollowUps({
  workflows,
  planAllows,
  planName,
}: {
  workflows: WorkflowLite[];
  planAllows: boolean;
  planName: string;
}) {
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const [busy, setBusy] = React.useState<string | null>(null);
  const page = useQuery({
    queryKey: ["grow-page"],
    queryFn: () => api<PageSettings>("/api/v1/grow/page"),
  });

  const toggleRecipe = useMutation({
    mutationFn: async ({ key, on }: { key: string; on: boolean }) => {
      const name = getTemplate(key)?.definition.name;
      let workflow = workflows.find((item) => item.name === name);
      if (!workflow && on)
        workflow = await api<WorkflowLite>("/api/v1/workflows", {
          method: "POST",
          json: { template: key },
        });
      if (workflow)
        await api(`/api/v1/workflows/${workflow.id}/status`, {
          method: "POST",
          json: { status: on ? "ACTIVE" : "PAUSED" },
        });
      return on;
    },
    onMutate: ({ key }) => setBusy(key),
    onSuccess: (on) =>
      toast.success(on ? "Switched on — it works in the background from now" : "Switched off"),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => {
      setBusy(null);
      void queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
  const toggleAfterWin = useMutation({
    mutationFn: (on: boolean) =>
      api<PageSettings>("/api/v1/grow/page", {
        method: "PUT",
        json: { ...page.data!, afterWinFollowUps: on },
      }),
    onMutate: () => setBusy("after-win"),
    onSuccess: (updated) => {
      queryClient.setQueryData(["grow-page"], updated);
      toast.success(updated.afterWinFollowUps ? "Switched on" : "Switched off");
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => setBusy(null),
  });

  const onCount =
    RECIPES.filter((recipe) =>
      workflows.some(
        (item) =>
          item.name === getTemplate(recipe.key)?.definition.name && item.status === "ACTIVE",
      ),
    ).length + (page.data?.afterWinFollowUps ? 1 : 0);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-[14.5px] font-semibold">Ready-made follow-ups</h2>
          <p className="text-[12.5px] text-foreground-muted">
            Switch on what you want. Each one runs by itself in the background.
          </p>
        </div>
        <Badge tone={onCount ? "success" : "neutral"}>
          {onCount} of {RECIPES.length + 1} on
        </Badge>
      </header>
      {!planAllows ? (
        <p className="border-b border-border bg-warning-soft/40 px-4 py-2 text-[12.5px] text-warning-text">
          Most follow-ups need the Pro plan (you&apos;re on {planName}).{" "}
          <Link href="/app/billing" className="font-medium underline underline-offset-2">
            See plans
          </Link>
        </p>
      ) : null}
      <ul className="divide-y divide-border">
        <Row
          icon={HeartHandshake}
          when="After every sale"
          then="get a review link ready and remind me to ask for a review in 3 days — then to check in for repeat business after 30 days."
          on={Boolean(page.data?.afterWinFollowUps)}
          busy={busy === "after-win"}
          disabled={!canWrite || !page.data}
          onChange={(on) => toggleAfterWin.mutate(on)}
          note={
            <>
              <Star className="mr-1 inline size-3" />
              Reviews appear on{" "}
              <Link href="/app/grow" className="underline underline-offset-2">
                your page
              </Link>
              . Works on every plan.
            </>
          }
        />
        {RECIPES.map((recipe) => {
          const workflow = workflows.find(
            (item) => item.name === getTemplate(recipe.key)?.definition.name,
          );
          const on = workflow?.status === "ACTIVE";
          return (
            <Row
              key={recipe.key}
              icon={recipe.icon}
              when={recipe.when}
              then={recipe.then}
              on={on}
              busy={busy === recipe.key}
              disabled={!canWrite || !planAllows}
              onChange={(next) => toggleRecipe.mutate({ key: recipe.key, on: next })}
              note={
                on && workflow
                  ? workflow.runs30d
                    ? `Ran ${workflow.runs30d} time${workflow.runs30d === 1 ? "" : "s"} in the last 30 days.`
                    : "On — waiting for the first time it's needed."
                  : undefined
              }
            />
          );
        })}
      </ul>
    </section>
  );
}
