"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, ArrowUpRight, CalendarDays, CalendarPlus, Circle, CircleCheck, Download, FileText, MoreHorizontal, Plus, Sparkles, Trash2, Trophy, XCircle } from "lucide-react";
import { DEAL_STAGE_LABELS, DEAL_STAGES, EVENT_LABELS, MEETING_STATUS_LABELS, eventTone, type DealStage } from "@repo/config";
import {
  Badge,
  Button,
  CompanyMark,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Skeleton,
  Textarea,
  Timeline,
  cn,
  toast,
  type TimelineItem,
} from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { useCanWrite } from "../shell/shell-context";
import { LocalTime } from "../time";
import { useNewQuote } from "../quotes/use-new-quote";
import { LostDialog, MeetingDialog, TaskDialog, WonDialog, useInvalidateCrm } from "./deal-dialogs";
import { CHANNEL_ICON, DueText, QuoteStatusBadge, StageDot, daysSince, money, useCrm } from "./shared";

interface DealDetail {
  id: string;
  title: string;
  stage: DealStage;
  value: number;
  currency: string;
  probability: number;
  explicitProbability: number | null;
  expectedCloseDate: string | null;
  stageChangedAt: string;
  createdAt: string;
  sourceChannel: keyof typeof CHANNEL_ICON | null;
  lostReason: string | null;
  ownerId: string | null;
  contactId: string | null;
  lead: { id: string; name: string; city: string | null; locality: string | null; status: string };
  owner: { id: string; name: string } | null;
  campaign: { id: string; name: string } | null;
  tasks: Array<{ id: string; title: string; status: string; dueAt: string | null; priority: string; assignee: { id: string; name: string } | null }>;
  notes: Array<{ id: string; body: string; createdAt: string; author: { id: string; name: string } | null }>;
  meetings: Array<{ id: string; title: string; scheduledAt: string; durationMinutes: number; status: string; location: string | null; source: string }>;
  quotes: Array<{ id: string; number: string; title: string | null; status: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED"; total: number; currency: string; sentAt: string | null; createdAt: string }>;
  events: Array<{ id: string; type: string; occurredAt: string; properties: Record<string, unknown> | null }>;
  contacts: Array<{ id: string; name: string | null; title: string | null; email: string | null }>;
}

function describe(event: DealDetail["events"][number], currency: string): string | undefined {
  const p = event.properties ?? {};
  switch (event.type) {
    case "deal_stage_changed":
      return `${String(p.fromLabel ?? p.from)} → ${String(p.toLabel ?? p.to)}`;
    case "deal_won":
      return typeof p.value === "number" && p.value ? money(p.value, currency) : undefined;
    case "deal_lost":
      return p.reason ? String(p.reason) : undefined;
    case "quote_created":
    case "quote_sent":
    case "quote_viewed":
    case "quote_accepted":
    case "quote_rejected":
    case "quote_expired":
      return [p.number, typeof p.total === "number" ? money(p.total, currency) : null, p.by ? `by ${String(p.by)}` : null].filter(Boolean).join(" · ") || undefined;
    case "lead_status_changed":
      return `${String(p.fromLabel ?? p.from)} → ${String(p.toLabel ?? p.to)}`;
    case "task_created":
    case "task_completed":
      return p.title ? String(p.title) : undefined;
    default:
      return undefined;
  }
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-foreground-muted uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-center gap-3 py-1">
      <span className="text-xs text-foreground-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function DealBody({ deal, onClose }: { deal: DealDetail; onClose: () => void }) {
  const canWrite = useCanWrite();
  const { members, quotesEnabled } = useCrm();
  const invalidate = useInvalidateCrm();
  const newQuote = useNewQuote();
  const [closing, setClosing] = React.useState<"WON" | "LOST" | null>(null);
  const [dialog, setDialog] = React.useState<"meeting" | "task" | null>(null);
  const [note, setNote] = React.useState("");
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const update = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api(`/api/v1/deals/${deal.id}`, { method: "PATCH", json: patch }),
    onSuccess: () => invalidate(),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const move = useMutation({
    mutationFn: (input: { stage: DealStage; lostReason?: string; value?: number }) => api(`/api/v1/deals/${deal.id}/move`, { method: "POST", json: input }),
    onSuccess: (_, input) => {
      toast.success(input.stage === "WON" ? "Deal won — nice work" : `Moved to ${DEAL_STAGE_LABELS[input.stage]}`);
      setClosing(null);
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const task = useMutation({
    mutationFn: (input: { id: string; status: "OPEN" | "DONE" }) => api(`/api/v1/tasks/${input.id}`, { method: "PATCH", json: { status: input.status } }),
    onSuccess: () => invalidate(),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const meeting = useMutation({
    mutationFn: (input: { id: string; status: string }) => api(`/api/v1/meetings/${input.id}`, { method: "PATCH", json: { status: input.status } }),
    onSuccess: () => invalidate(),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const addNote = useMutation({
    mutationFn: () => api(`/api/v1/deals/${deal.id}/notes`, { method: "POST", json: { body: note } }),
    onSuccess: () => {
      setNote("");
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/v1/deals/${deal.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Deal deleted");
      invalidate();
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const closed = deal.stage === "WON" || deal.stage === "LOST";
  const ChannelIcon = deal.sourceChannel ? CHANNEL_ICON[deal.sourceChannel] : null;
  const openTasks = deal.tasks.filter((item) => item.status === "OPEN");
  const doneTasks = deal.tasks.filter((item) => item.status === "DONE").slice(0, 3);
  const timeline: TimelineItem[] = deal.events.map((event) => ({
    id: event.id,
    time: <LocalTime value={event.occurredAt} />,
    title: EVENT_LABELS[event.type] ?? event.type.replace(/_/g, " "),
    description: describe(event, deal.currency),
    tone: eventTone(event.type),
    icon: event.type.startsWith("quote") ? FileText : event.type.startsWith("deal") ? Trophy : Activity,
  }));

  return (
    <>
      <div className="border-b border-border px-5 pt-5 pb-4">
        <div className="flex items-start gap-3">
          <CompanyMark name={deal.lead.name} className="size-10 text-sm" />
          <div className="min-w-0 flex-1">
            <SheetTitle className="sr-only">{deal.title}</SheetTitle>
            <Input
              key={deal.title}
              defaultValue={deal.title}
              aria-label="Deal name"
              disabled={!canWrite}
              onBlur={(event) => {
                const title = event.target.value.trim();
                if (title && title !== deal.title) update.mutate({ title });
              }}
              className="-ml-2 h-8 border-transparent px-2 text-base font-semibold shadow-none hover:border-border focus-visible:border-border"
            />
            <SheetDescription asChild>
              <Link href={`/app/leads/${deal.lead.id}`} className="inline-flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground hover:underline">
                {deal.lead.name}
                {deal.lead.city ? ` · ${deal.lead.city}` : ""} <ArrowUpRight className="size-3" />
              </Link>
            </SheetDescription>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Select
            value={deal.stage}
            disabled={!canWrite || move.isPending}
            onValueChange={(next) => {
              const stage = next as DealStage;
              if (stage === "WON" || stage === "LOST") setClosing(stage);
              else move.mutate({ stage });
            }}
          >
            <SelectTrigger className="h-8 w-44" aria-label="Stage">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEAL_STAGES.map((stage) => (
                <SelectItem key={stage} value={stage}>
                  <span className="inline-flex items-center gap-2">
                    <StageDot stage={stage} /> {DEAL_STAGE_LABELS[stage]}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canWrite && !closed ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => setClosing("WON")}>
                <Trophy className="text-good" /> Won
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setClosing("LOST")}>
                <XCircle /> Lost
              </Button>
            </>
          ) : null}
          <span className="ml-auto text-[11px] text-foreground-muted">
            {closed ? (deal.stage === "WON" ? "Won" : `Lost${deal.lostReason ? `: ${deal.lostReason}` : ""}`) : `${daysSince(deal.stageChangedAt)}d in stage · open ${daysSince(deal.createdAt)}d`}
          </span>
        </div>
      </div>

      <div className="grid gap-6 overflow-y-auto px-5 py-5">
        <div className="grid">
          <FieldRow label="Value">
            <div className="flex items-center gap-2">
              <Input
                key={deal.value}
                type="number"
                min={0}
                defaultValue={deal.value || ""}
                placeholder="0"
                disabled={!canWrite}
                aria-label="Deal value"
                className="h-8 w-40 tabular"
                onBlur={(event) => {
                  const value = Number(event.target.value) || 0;
                  if (value !== deal.value) update.mutate({ value });
                }}
              />
              <span className="text-xs text-foreground-muted">{deal.currency}, before tax</span>
            </div>
          </FieldRow>
          <FieldRow label="Probability">
            <div className="flex items-center gap-2">
              <Input
                key={`${deal.stage}-${deal.explicitProbability}`}
                type="number"
                min={0}
                max={100}
                defaultValue={deal.explicitProbability ?? ""}
                placeholder={String(deal.probability)}
                disabled={!canWrite || closed}
                aria-label="Win probability"
                className="h-8 w-20 tabular"
                onBlur={(event) => {
                  const raw = event.target.value.trim();
                  const probability = raw === "" ? null : Math.min(100, Math.max(0, Math.round(Number(raw))));
                  if (probability !== deal.explicitProbability) update.mutate({ probability });
                }}
              />
              <span className="text-xs text-foreground-muted">% {deal.explicitProbability === null ? `(stage default) · weighted ${money((deal.value * deal.probability) / 100, deal.currency)}` : `· weighted ${money((deal.value * deal.probability) / 100, deal.currency)}`}</span>
            </div>
          </FieldRow>
          <FieldRow label="Expected close">
            <Input
              key={deal.expectedCloseDate ?? "none"}
              type="date"
              defaultValue={deal.expectedCloseDate ? deal.expectedCloseDate.slice(0, 10) : ""}
              disabled={!canWrite}
              aria-label="Expected close date"
              className="h-8 w-44"
              onChange={(event) => update.mutate({ expectedCloseDate: event.target.value ? new Date(`${event.target.value}T12:00:00`).toISOString() : null })}
            />
          </FieldRow>
          <FieldRow label="Owner">
            <Select value={deal.ownerId ?? "none"} disabled={!canWrite} onValueChange={(next) => update.mutate({ ownerId: next === "none" ? null : next })}>
              <SelectTrigger className="h-8 w-56" aria-label="Owner">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {members.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="Contact">
            {deal.contacts.length ? (
              <Select value={deal.contactId ?? "none"} disabled={!canWrite} onValueChange={(next) => update.mutate({ contactId: next === "none" ? null : next })}>
                <SelectTrigger className="h-8 w-56" aria-label="Contact">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No contact</SelectItem>
                  {deal.contacts.map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contact.name ?? contact.email ?? "Unnamed"}
                      {contact.title ? ` · ${contact.title}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-xs text-foreground-muted">No contacts on this company yet</span>
            )}
          </FieldRow>
          <FieldRow label="Source">
            <span className="inline-flex items-center gap-1.5 text-[13px] text-foreground-secondary">
              {ChannelIcon ? <ChannelIcon className="size-3.5" /> : null}
              {deal.sourceChannel ? deal.sourceChannel.replace("_", " ").toLowerCase() : "Added manually"}
              {deal.campaign ? (
                <>
                  {" · "}
                  <Link href={`/app/campaigns/${deal.campaign.id}`} className="hover:underline">
                    {deal.campaign.name}
                  </Link>
                </>
              ) : null}
            </span>
          </FieldRow>
        </div>

        <Section
          title="Quotes"
          action={
            canWrite && quotesEnabled ? (
              <div className="flex gap-1">
                <Button size="xs" variant="ghost" loading={newQuote.draft.isPending} disabled={newQuote.pending} onClick={() => newQuote.draft.mutate({ leadId: deal.lead.id, dealId: deal.id })}>
                  <Sparkles /> Draft with AI
                </Button>
                <Button size="xs" variant="secondary" loading={newQuote.blank.isPending} disabled={newQuote.pending} onClick={() => newQuote.blank.mutate({ leadId: deal.lead.id, dealId: deal.id })}>
                  <Plus /> New quote
                </Button>
              </div>
            ) : null
          }
        >
          {deal.quotes.length ? (
            <ul className="grid gap-1.5">
              {deal.quotes.map((quote) => (
                <li key={quote.id}>
                  <Link href={`/app/crm/quotes/${quote.id}`} className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 transition-colors hover:border-border-strong">
                    <FileText className="size-4 shrink-0 text-foreground-subtle" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{quote.number}</span>
                      <span className="block truncate text-[11px] text-foreground-muted">{quote.title ?? "Untitled"}</span>
                    </span>
                    <span className="text-[13px] font-medium tabular">{money(quote.total, quote.currency)}</span>
                    <QuoteStatusBadge status={quote.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-foreground-muted">{quotesEnabled ? "No quotes yet. Draft one with AI from the conversation — prices always come from your catalog." : "Quotes are available on the Pro and Scale plans."}</p>
          )}
        </Section>

        <Section
          title="Next steps"
          action={
            canWrite ? (
              <Button size="xs" variant="ghost" onClick={() => setDialog("task")}>
                <Plus /> Task
              </Button>
            ) : null
          }
        >
          {openTasks.length || doneTasks.length ? (
            <ul className="grid gap-1">
              {[...openTasks, ...doneTasks].map((item) => {
                const done = item.status === "DONE";
                return (
                  <li key={item.id} className="flex items-center gap-2.5 rounded-md px-1 py-1 hover:bg-surface-muted/60">
                    <button type="button" aria-label={done ? `Reopen ${item.title}` : `Complete ${item.title}`} disabled={!canWrite} onClick={() => task.mutate({ id: item.id, status: done ? "OPEN" : "DONE" })} className="text-foreground-subtle hover:text-good">
                      {done ? <CircleCheck className="size-4 text-good" /> : <Circle className="size-4" />}
                    </button>
                    <span className={cn("min-w-0 flex-1 truncate text-[13px]", done && "text-foreground-muted line-through")}>{item.title}</span>
                    {item.dueAt && !done ? <DueText value={item.dueAt} className="text-xs" /> : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs text-foreground-muted">No open tasks — every open deal should have a next step.</p>
          )}
        </Section>

        <Section
          title="Meetings"
          action={
            canWrite ? (
              <Button size="xs" variant="ghost" onClick={() => setDialog("meeting")}>
                <CalendarPlus /> Schedule
              </Button>
            ) : null
          }
        >
          {deal.meetings.length ? (
            <ul className="grid gap-1.5">
              {deal.meetings.map((item) => (
                <li key={item.id} className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2">
                  <CalendarDays className="size-4 shrink-0 text-foreground-subtle" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{item.title}</span>
                    <span className="block truncate text-[11px] text-foreground-muted">
                      <LocalTime value={item.scheduledAt} /> · {item.durationMinutes} min{item.location ? ` · ${item.location}` : ""}
                    </span>
                  </span>
                  {item.status !== "SCHEDULED" ? <Badge tone={item.status === "COMPLETED" ? "success" : "neutral"}>{MEETING_STATUS_LABELS[item.status]}</Badge> : null}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-xs" variant="ghost" aria-label={`Meeting options for ${item.title}`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <a href={`/api/v1/meetings/${item.id}/ics`}>
                          <Download /> Add to calendar (.ics)
                        </a>
                      </DropdownMenuItem>
                      {canWrite && item.status === "SCHEDULED" ? (
                        <>
                          <DropdownMenuItem onSelect={() => meeting.mutate({ id: item.id, status: "COMPLETED" })}>Mark completed</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => meeting.mutate({ id: item.id, status: "NO_SHOW" })}>Mark no-show</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => meeting.mutate({ id: item.id, status: "CANCELED" })}>Cancel meeting</DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-foreground-muted">No meetings yet.</p>
          )}
        </Section>

        <Section title="Notes">
          {canWrite ? (
            <div className="grid gap-2 rounded-lg border border-border bg-surface p-2.5">
              <Textarea rows={2} placeholder="What did you learn? Budget, timing, decision makers…" value={note} onChange={(event) => setNote(event.target.value)} className="border-0 px-0 shadow-none focus-visible:ring-0" aria-label="New note" />
              <div className="flex justify-end">
                <Button size="xs" variant="primary" disabled={!note.trim()} loading={addNote.isPending} onClick={() => addNote.mutate()}>
                  Add note
                </Button>
              </div>
            </div>
          ) : null}
          {deal.notes.length ? (
            <ul className="grid gap-2">
              {deal.notes.map((item) => (
                <li key={item.id} className="rounded-md bg-surface-muted/60 px-3 py-2">
                  <p className="text-[13px] whitespace-pre-wrap">{item.body}</p>
                  <p className="mt-1 text-[11px] text-foreground-muted">
                    {item.author?.name ?? "Someone"} · <LocalTime value={item.createdAt} />
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </Section>

        <Section title="Activity">{timeline.length ? <Timeline items={timeline} /> : <EmptyState compact icon={Activity} title="No activity yet" />}</Section>

        {canWrite ? (
          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            {confirmDelete ? (
              <>
                <span className="text-xs text-foreground-muted">Delete this deal? Tasks, notes and quotes stay on the company.</span>
                <Button size="xs" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
                <Button size="xs" variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
                  Delete
                </Button>
              </>
            ) : (
              <Button size="xs" variant="ghost" onClick={() => setConfirmDelete(true)}>
                <Trash2 /> Delete deal
              </Button>
            )}
          </div>
        ) : null}
      </div>

      <WonDialog key={`won-${closing}`} deal={closing === "WON" ? deal : null} pending={move.isPending} onCancel={() => setClosing(null)} onConfirm={(value) => move.mutate({ stage: "WON", value })} />
      <LostDialog key={`lost-${closing}`} deal={closing === "LOST" ? deal : null} pending={move.isPending} onCancel={() => setClosing(null)} onConfirm={(lostReason) => move.mutate({ stage: "LOST", lostReason })} />
      {dialog === "meeting" ? <MeetingDialog open onOpenChange={(open) => (open ? null : setDialog(null))} lead={deal.lead} dealId={deal.id} /> : null}
      {dialog === "task" ? <TaskDialog open onOpenChange={(open) => (open ? null : setDialog(null))} lead={deal.lead} dealId={deal.id} /> : null}
    </>
  );
}

/** Side panel with everything about one deal. */
export function DealSheet({ dealId, onClose }: { dealId: string | null; onClose: () => void }) {
  const deal = useQuery({ queryKey: ["deal", dealId], queryFn: () => api<DealDetail>(`/api/v1/deals/${dealId}`), enabled: Boolean(dealId) });
  return (
    <Sheet open={Boolean(dealId)} onOpenChange={(open) => (open ? null : onClose())}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-[560px]">
        {deal.isPending ? (
          <div className="grid gap-3 p-5">
            <SheetTitle className="sr-only">Loading deal</SheetTitle>
            <Skeleton className="h-10" />
            <Skeleton className="h-40" />
            <Skeleton className="h-24" />
          </div>
        ) : deal.isError ? (
          <div className="p-5">
            <SheetTitle className="sr-only">Deal</SheetTitle>
            <ErrorState description={errorMessage(deal.error)} onRetry={() => void deal.refetch()} />
          </div>
        ) : (
          <DealBody deal={deal.data} onClose={onClose} />
        )}
      </SheetContent>
    </Sheet>
  );
}
