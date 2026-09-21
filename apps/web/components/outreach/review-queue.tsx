"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCheck, ChevronDown, FlaskConical, Pencil, SkipForward, Sparkles, UserX } from "lucide-react";
import type { Channel } from "@repo/config";
import {
  Badge,
  Button,
  Checkbox,
  CompanyMark,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  Input,
  ScoreIndicator,
  Skeleton,
  Textarea,
  cn,
  toast,
} from "@repo/ui";
import { apiWithMeta, api, errorMessage } from "@/lib/api-client";
import { useCanWrite } from "../shell/shell-context";
import { RelativeTime } from "../time";
import { ChannelIcon } from "./shared";

interface ApprovalItem {
  id: string;
  channel: Channel;
  status: "DRAFT" | "PENDING_APPROVAL";
  subject: string | null;
  body: string;
  toAddress: string | null;
  generatedByAI: boolean;
  templateName: string | null;
  createdAt: string;
  metadata: { personalization?: string[]; simulated?: boolean; editedByHuman?: boolean } | null;
  lead: { id: string; name: string; category: string | null; city: string | null; locality: string | null; score: number | null; sourceProvider: string };
  campaign: { id: string; name: string; automationMode: string } | null;
  campaignStep: { name: string; order: number } | null;
}

function ReviewCard({ item, selected, onSelect }: { item: ApprovalItem; selected: boolean; onSelect: (value: boolean) => void }) {
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const [editing, setEditing] = React.useState(false);
  const [subject, setSubject] = React.useState(item.subject ?? "");
  const [body, setBody] = React.useState(item.body);
  const dirty = body !== item.body || subject !== (item.subject ?? "");

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["approvals"] });
    void queryClient.invalidateQueries({ queryKey: ["campaign-stats"] });
    void queryClient.invalidateQueries({ queryKey: ["inbox-summary"] });
  };
  const approve = useMutation({
    mutationFn: () => api(`/api/v1/approvals/${item.id}/approve`, { method: "POST", json: dirty ? { body, ...(item.channel === "EMAIL" ? { subject } : {}) } : {} }),
    onSuccess: () => {
      toast.success(`Approved — sending to ${item.lead.name}`);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const reject = useMutation({
    mutationFn: (action: "skip_step" | "stop_lead") => api(`/api/v1/approvals/${item.id}/reject`, { method: "POST", json: { action } }),
    onSuccess: (_, action) => {
      toast.success(action === "stop_lead" ? `${item.lead.name} removed from the sequence` : "Step skipped");
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const busy = approve.isPending || reject.isPending;
  const place = [item.lead.locality, item.lead.city].filter(Boolean).join(", ");
  const personalization = item.metadata?.personalization ?? [];

  return (
    <article className={cn("rounded-lg border bg-surface shadow-xs transition-colors", selected ? "border-accent/60" : "border-border")}>
      <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        {canWrite ? <Checkbox checked={selected} onCheckedChange={(value) => onSelect(value === true)} aria-label={`Select message to ${item.lead.name}`} /> : null}
        <CompanyMark name={item.lead.name} className="size-7 text-[11px]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link href={`/app/leads/${item.lead.id}`} className="truncate text-[13px] font-semibold hover:underline">
              {item.lead.name}
            </Link>
            <ScoreIndicator score={item.lead.score} size="sm" />
          </div>
          <p className="truncate text-xs text-foreground-muted">
            {[place, item.toAddress].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="hidden shrink-0 items-center gap-2 text-xs text-foreground-muted sm:flex">
          <span className="inline-flex items-center gap-1">
            <ChannelIcon channel={item.channel} className="size-3" /> {item.campaignStep?.name ?? "Message"}
          </span>
          {item.campaign ? (
            <Link href={`/app/campaigns/${item.campaign.id}`} className="max-w-40 truncate hover:text-foreground hover:underline">
              {item.campaign.name}
            </Link>
          ) : null}
          <RelativeTime value={item.createdAt} />
        </div>
      </header>

      <div className="px-4 py-3">
        {editing ? (
          <div className="grid gap-2">
            {item.channel === "EMAIL" ? <Input value={subject} onChange={(event) => setSubject(event.target.value)} aria-label="Subject" /> : null}
            <Textarea value={body} onChange={(event) => setBody(event.target.value)} rows={Math.min(14, Math.max(5, body.split("\n").length + 1))} aria-label="Message" />
          </div>
        ) : (
          <button type="button" onClick={() => canWrite && !item.templateName && setEditing(true)} className="block w-full text-left" disabled={!canWrite || Boolean(item.templateName)}>
            {item.channel === "EMAIL" && subject ? <p className="text-[13px] font-semibold">{subject}</p> : null}
            <p className="mt-1 line-clamp-6 text-[13px] leading-relaxed whitespace-pre-wrap text-foreground-secondary">{body}</p>
          </button>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {item.generatedByAI ? (
            <Badge tone="accent">
              <Sparkles /> AI personalised
            </Badge>
          ) : null}
          {item.templateName ? <Badge tone="outline">Template · {item.templateName}</Badge> : null}
          {item.metadata?.simulated ? (
            <Badge tone="warning">
              <FlaskConical /> Demo provider
            </Badge>
          ) : null}
          {personalization.slice(0, 3).map((note) => (
            <Badge key={note} tone="neutral" className="max-w-64 truncate">
              {note}
            </Badge>
          ))}
        </div>
      </div>

      {canWrite ? (
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-2.5">
          {editing ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setBody(item.body);
                setSubject(item.subject ?? "");
                setEditing(false);
              }}
            >
              Cancel edits
            </Button>
          ) : item.templateName ? null : (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="secondary" disabled={busy}>
                Reject <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => reject.mutate("skip_step")}>
                <SkipForward /> Skip this step
              </DropdownMenuItem>
              <DropdownMenuItem destructive onSelect={() => reject.mutate("stop_lead")}>
                <UserX /> Stop outreach to this lead
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="primary" onClick={() => approve.mutate()} disabled={busy || !body.trim()}>
            <Check /> {dirty ? "Save & approve" : "Approve & send"}
          </Button>
        </footer>
      ) : null}
    </article>
  );
}

/** Human-in-the-loop queue: drafts and messages awaiting approval. */
export function ReviewQueue({ campaignId, channel, emptyAction }: { campaignId?: string; channel?: "EMAIL" | "WHATSAPP"; emptyAction?: React.ReactNode }) {
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const params = new URLSearchParams();
  if (campaignId) params.set("campaignId", campaignId);
  if (channel) params.set("channel", channel);
  params.set("limit", "50");

  const query = useQuery({
    queryKey: ["approvals", campaignId ?? null, channel ?? null],
    queryFn: () => apiWithMeta<ApprovalItem[], { total: number }>(`/api/v1/approvals?${params.toString()}`),
    refetchInterval: 20_000,
  });
  const bulk = useMutation({
    mutationFn: (input: { ids: string[]; action: "approve" | "reject" }) => api<{ succeeded: number; failed: Array<{ id: string; error: string }> }>("/api/v1/approvals/bulk", { method: "POST", json: input }),
    onSuccess: (result, input) => {
      if (result.failed.length) toast.warning(`${result.succeeded} ${input.action === "approve" ? "approved" : "rejected"}, ${result.failed.length} failed: ${result.failed[0]?.error ?? ""}`);
      else toast.success(`${result.succeeded} message${result.succeeded === 1 ? "" : "s"} ${input.action === "approve" ? "approved" : "rejected"}`);
      setSelected(new Set());
      void queryClient.invalidateQueries({ queryKey: ["approvals"] });
      void queryClient.invalidateQueries({ queryKey: ["campaign-stats"] });
      void queryClient.invalidateQueries({ queryKey: ["inbox-summary"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (query.isPending) {
    return (
      <div className="grid gap-3">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-44" />
        ))}
      </div>
    );
  }
  if (query.isError) return <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />;

  const items = query.data.data;
  const visibleSelected = items.filter((item) => selected.has(item.id)).map((item) => item.id);
  if (!items.length) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface">
        <EmptyState icon={CheckCheck} title="Nothing waiting for review" description="Messages that need your approval appear here before anything is sent." action={emptyAction} />
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {canWrite ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-xs text-foreground-muted">
            <Checkbox
              checked={visibleSelected.length === items.length ? true : visibleSelected.length ? "indeterminate" : false}
              onCheckedChange={(value) => setSelected(value === true ? new Set(items.map((item) => item.id)) : new Set())}
              aria-label="Select all"
            />
            {visibleSelected.length ? `${visibleSelected.length} selected` : `${query.data.meta.total} awaiting review`}
          </label>
          {visibleSelected.length ? (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" disabled={bulk.isPending} onClick={() => bulk.mutate({ ids: visibleSelected, action: "reject" })}>
                Skip selected
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={bulk.isPending}
                onClick={() => window.confirm(`Approve and send ${visibleSelected.length} message${visibleSelected.length === 1 ? "" : "s"}?`) && bulk.mutate({ ids: visibleSelected, action: "approve" })}
              >
                <CheckCheck /> Approve {visibleSelected.length}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {items.map((item) => (
        <ReviewCard
          key={item.id}
          item={item}
          selected={selected.has(item.id)}
          onSelect={(value) =>
            setSelected((current) => {
              const next = new Set(current);
              if (value) next.add(item.id);
              else next.delete(item.id);
              return next;
            })
          }
        />
      ))}
    </div>
  );
}
