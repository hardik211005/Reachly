"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PhoneCall } from "lucide-react";
import { Button, Skeleton } from "@repo/ui";
import { api, apiWithMeta } from "@/lib/api-client";
import { useCanWrite } from "../shell/shell-context";
import { RelativeTime } from "../time";
import type { CallReadiness, CallRow } from "./calls-view";
import { CallStatusBadge, CallTypeLabel, NewCallDialog, OutcomeBadge, formatDuration } from "./shared";

/** Calls with one lead, on the lead workspace. */
export function LeadCalls({ lead }: { lead: { id: string; name: string; city: string | null; locality: string | null; score: number | null; phone: string | null; doNotContact: boolean } }) {
  const canWrite = useCanWrite();
  const [open, setOpen] = React.useState(false);
  const calls = useQuery({ queryKey: ["calls", "lead", lead.id], queryFn: () => apiWithMeta<CallRow[]>(`/api/v1/calls?leadId=${lead.id}&pageSize=20`), refetchInterval: 10_000 });
  const readiness = useQuery({ queryKey: ["call-readiness"], queryFn: () => api<CallReadiness>("/api/v1/calls/readiness") });
  const items = calls.data?.data ?? [];

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-semibold">Calls</h3>
          <p className="text-xs text-foreground-muted">{lead.phone ? `AI agent or manual calls to ${lead.phone}` : "No phone number on file"}</p>
        </div>
        {canWrite && lead.phone && !lead.doNotContact ? (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            <PhoneCall /> Prepare call
          </Button>
        ) : null}
      </div>
      {calls.isPending ? (
        <Skeleton className="h-16" />
      ) : items.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
          {items.map((call) => (
            <li key={call.id}>
              <Link href={`/app/calls/${call.id}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-muted/50">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-foreground-secondary">
                  <PhoneCall className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    {call.outcome ? <OutcomeBadge outcome={call.outcome} /> : <CallStatusBadge status={call.status} scheduledFor={call.scheduledFor} />}
                    <CallTypeLabel type={call.type} />
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-foreground-muted">{call.summary ?? call.brief?.objective ?? ""}</span>
                </span>
                <span className="shrink-0 text-right text-[11px] text-foreground-muted">
                  {call.answeredAt ? <span className="block tabular">{formatDuration(call.durationSeconds)}</span> : null}
                  <RelativeTime value={call.startedAt ?? call.createdAt} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-border bg-surface px-4 py-4 text-center text-[13px] text-foreground-muted">No calls yet. Prepare one to get a brief and a script.</p>
      )}
      {canWrite ? <NewCallDialog key={String(open)} open={open} onOpenChange={setOpen} lead={lead} aiAvailable={Boolean(readiness.data?.ready)} /> : null}
    </section>
  );
}
