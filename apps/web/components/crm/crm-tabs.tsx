"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarDays, CalendarPlus, Circle, CircleCheck, Download, ListTodo, Mail, MoreHorizontal, Phone, Plus, Trash2, Users } from "lucide-react";
import { MEETING_STATUS_LABELS, TASK_TYPE_LABELS, type DealStage, type TaskType } from "@repo/config";
import {
  Avatar,
  Badge,
  Button,
  CompanyMark,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  SearchInput,
  SegmentedControl,
  Skeleton,
  cn,
  toast,
} from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { useCanWrite } from "../shell/shell-context";
import { LocalTime } from "../time";
import { MeetingDialog, TaskDialog, useInvalidateCrm } from "./deal-dialogs";
import { DueText, StageLabel } from "./shared";

// ----------------------------------------------------------------------------- Tasks

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  type: TaskType;
  priority: "LOW" | "MEDIUM" | "HIGH";
  status: "OPEN" | "DONE" | "CANCELED";
  dueAt: string | null;
  completedAt: string | null;
  workflowExecutionId: string | null;
  assignee: { id: string; name: string } | null;
  lead: { id: string; name: string } | null;
  deal: { id: string; title: string; stage: DealStage } | null;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function groupTasks(tasks: TaskRow[]) {
  const today = startOfDay(new Date()).getTime();
  const week = today + 7 * 86_400_000;
  const groups: Array<{ key: string; label: string; tone?: "danger" | "warning"; items: TaskRow[] }> = [
    { key: "overdue", label: "Overdue", tone: "danger", items: [] },
    { key: "today", label: "Today", tone: "warning", items: [] },
    { key: "week", label: "Next 7 days", items: [] },
    { key: "later", label: "Later", items: [] },
    { key: "none", label: "No due date", items: [] },
  ];
  for (const task of tasks) {
    if (!task.dueAt) groups[4]!.items.push(task);
    else {
      const day = startOfDay(new Date(task.dueAt)).getTime();
      if (day < today) groups[0]!.items.push(task);
      else if (day === today) groups[1]!.items.push(task);
      else if (day < week) groups[2]!.items.push(task);
      else groups[3]!.items.push(task);
    }
  }
  return groups.filter((group) => group.items.length);
}

function TaskItem({ task, onOpenDeal }: { task: TaskRow; onOpenDeal: (id: string) => void }) {
  const canWrite = useCanWrite();
  const invalidate = useInvalidateCrm();
  const done = task.status === "DONE";
  const toggle = useMutation({
    mutationFn: () => api(`/api/v1/tasks/${task.id}`, { method: "PATCH", json: { status: done ? "OPEN" : "DONE" } }),
    onSuccess: () => {
      if (!done) toast.success("Task completed");
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/v1/tasks/${task.id}`, { method: "DELETE" }),
    onSuccess: () => invalidate(),
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <li className="group flex items-center gap-3 px-3 py-2.5">
      <button type="button" aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`} disabled={!canWrite || toggle.isPending} onClick={() => toggle.mutate()} className="text-foreground-subtle transition-colors hover:text-good">
        {done ? <CircleCheck className="size-[18px] text-good" /> : <Circle className="size-[18px]" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-[13px] font-medium", done && "text-foreground-muted line-through")}>
          {task.priority === "HIGH" && !done ? <span className="mr-1.5 inline-block size-1.5 -translate-y-px rounded-full bg-critical align-middle" aria-label="High priority" /> : null}
          {task.title}
        </p>
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-[11px] text-foreground-muted">
          <span>{TASK_TYPE_LABELS[task.type]}</span>
          {task.lead ? (
            <Link href={`/app/leads/${task.lead.id}`} className="truncate hover:text-foreground hover:underline">
              {task.lead.name}
            </Link>
          ) : null}
          {task.deal ? (
            <button type="button" onClick={() => onOpenDeal(task.deal!.id)} className="inline-flex items-center hover:text-foreground">
              <StageLabel stage={task.deal.stage} />
            </button>
          ) : null}
          {task.workflowExecutionId ? <span>· from a workflow</span> : null}
        </p>
      </div>
      {task.dueAt && !done ? <DueText value={task.dueAt} className="text-xs" /> : null}
      {done && task.completedAt ? (
        <span className="text-xs text-foreground-muted">
          Done <LocalTime value={task.completedAt} style="date" />
        </span>
      ) : null}
      {task.assignee ? <Avatar name={task.assignee.name} size="xs" /> : null}
      {canWrite ? (
        <Button size="icon-xs" variant="ghost" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Delete ${task.title}`} onClick={() => remove.mutate()}>
          <Trash2 />
        </Button>
      ) : null}
    </li>
  );
}

export function TasksTab({ onOpenDeal }: { onOpenDeal: (id: string) => void }) {
  const canWrite = useCanWrite();
  const [assignee, setAssignee] = React.useState<"me" | "all">("me");
  const [status, setStatus] = React.useState<"OPEN" | "DONE">("OPEN");
  const [creating, setCreating] = React.useState(false);
  const tasks = useQuery({ queryKey: ["tasks", assignee, status], queryFn: () => api<TaskRow[]>(`/api/v1/tasks?assignee=${assignee}&status=${status}`) });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl size="sm" value={assignee} onValueChange={setAssignee} options={[{ value: "me", label: "My tasks" }, { value: "all", label: "Everyone" }]} />
        <SegmentedControl size="sm" value={status} onValueChange={setStatus} options={[{ value: "OPEN", label: "Open" }, { value: "DONE", label: "Done" }]} />
        {canWrite ? (
          <Button size="sm" variant="primary" className="ml-auto" onClick={() => setCreating(true)}>
            <Plus /> New task
          </Button>
        ) : null}
      </div>
      {tasks.isPending ? (
        <Skeleton className="h-64" />
      ) : tasks.isError ? (
        <ErrorState description={errorMessage(tasks.error)} onRetry={() => void tasks.refetch()} />
      ) : tasks.data.length === 0 ? (
        <EmptyState icon={ListTodo} title={status === "OPEN" ? "You're all caught up" : "Nothing completed yet"} description={status === "OPEN" ? "Tasks from workflows, call outcomes and declined quotes land here, next to the ones you add." : undefined} />
      ) : status === "DONE" ? (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {tasks.data.map((task) => (
            <TaskItem key={task.id} task={task} onOpenDeal={onOpenDeal} />
          ))}
        </ul>
      ) : (
        <div className="grid gap-4">
          {groupTasks(tasks.data).map((group) => (
            <section key={group.key}>
              <h3 className={cn("mb-1.5 flex items-center gap-2 px-1 text-xs font-semibold", group.tone === "danger" ? "text-danger-text" : group.tone === "warning" ? "text-warning-text" : "text-foreground-muted")}>
                {group.label}
                <span className="font-normal text-foreground-muted">{group.items.length}</span>
              </h3>
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
                {group.items.map((task) => (
                  <TaskItem key={task.id} task={task} onOpenDeal={onOpenDeal} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {creating ? <TaskDialog open onOpenChange={setCreating} /> : null}
    </div>
  );
}

// ----------------------------------------------------------------------------- Meetings

interface MeetingRow {
  id: string;
  title: string;
  scheduledAt: string;
  durationMinutes: number;
  location: string | null;
  status: "SCHEDULED" | "COMPLETED" | "CANCELED" | "NO_SHOW";
  source: string;
  lead: { id: string; name: string; city: string | null };
  deal: { id: string; title: string; stage: DealStage } | null;
}

function dayLabel(value: string) {
  const date = new Date(value);
  const days = Math.round((startOfDay(date).getTime() - startOfDay(new Date()).getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return date.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
}

const SOURCE_LABELS: Record<string, string> = { call: "Booked on an AI call", email: "From an email reply", whatsapp: "From WhatsApp", manual: "Added by hand", workflow: "From a workflow" };

export function MeetingsTab({ onOpenDeal }: { onOpenDeal: (id: string) => void }) {
  const canWrite = useCanWrite();
  const invalidate = useInvalidateCrm();
  const [when, setWhen] = React.useState<"upcoming" | "past">("upcoming");
  const [creating, setCreating] = React.useState(false);
  const meetings = useQuery({ queryKey: ["meetings", when], queryFn: () => api<MeetingRow[]>(`/api/v1/meetings?when=${when}`) });
  const update = useMutation({
    mutationFn: (input: { id: string; status: MeetingRow["status"] }) => api(`/api/v1/meetings/${input.id}`, { method: "PATCH", json: { status: input.status } }),
    onSuccess: () => invalidate(),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const groups = new Map<string, MeetingRow[]>();
  for (const meeting of meetings.data ?? []) {
    const key = dayLabel(meeting.scheduledAt);
    groups.set(key, [...(groups.get(key) ?? []), meeting]);
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl size="sm" value={when} onValueChange={setWhen} options={[{ value: "upcoming", label: "Upcoming" }, { value: "past", label: "Past" }]} />
        {canWrite ? (
          <Button size="sm" variant="primary" className="ml-auto" onClick={() => setCreating(true)}>
            <CalendarPlus /> Schedule meeting
          </Button>
        ) : null}
      </div>
      {meetings.isPending ? (
        <Skeleton className="h-64" />
      ) : meetings.isError ? (
        <ErrorState description={errorMessage(meetings.error)} onRetry={() => void meetings.refetch()} />
      ) : meetings.data.length === 0 ? (
        <EmptyState icon={CalendarDays} title={when === "upcoming" ? "No meetings scheduled" : "No past meetings"} description={when === "upcoming" ? "Meetings booked on AI calls, from replies and by your team appear here." : undefined} />
      ) : (
        <div className="grid gap-5">
          {[...groups.entries()].map(([day, items]) => (
            <section key={day}>
              <h3 className="mb-1.5 px-1 text-xs font-semibold text-foreground-muted">{day}</h3>
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
                {items.map((meeting) => (
                  <li key={meeting.id} className="flex items-center gap-4 px-3 py-3">
                    <div className="w-16 shrink-0 text-right">
                      <p className="text-[13px] font-semibold tabular">
                        <LocalTime value={meeting.scheduledAt} style="time" />
                      </p>
                      <p className="text-[11px] text-foreground-muted">{meeting.durationMinutes} min</p>
                    </div>
                    <span aria-hidden className={cn("h-9 w-0.5 rounded-full", meeting.status === "SCHEDULED" ? "bg-series-4" : meeting.status === "COMPLETED" ? "bg-good" : "bg-border-strong")} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{meeting.title}</p>
                      <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-foreground-muted">
                        <Link href={`/app/leads/${meeting.lead.id}`} className="hover:text-foreground hover:underline">
                          {meeting.lead.name}
                        </Link>
                        {meeting.location ? <span>· {meeting.location}</span> : null}
                        <span>· {SOURCE_LABELS[meeting.source] ?? meeting.source}</span>
                      </p>
                    </div>
                    {meeting.deal ? (
                      <button type="button" onClick={() => onOpenDeal(meeting.deal!.id)} className="hidden rounded-md px-2 py-1 hover:bg-surface-muted sm:block" aria-label={`Open deal ${meeting.deal.title}`}>
                        <StageLabel stage={meeting.deal.stage} />
                      </button>
                    ) : null}
                    {meeting.status !== "SCHEDULED" ? <Badge tone={meeting.status === "COMPLETED" ? "success" : "neutral"}>{MEETING_STATUS_LABELS[meeting.status]}</Badge> : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon-xs" variant="ghost" aria-label={`Options for ${meeting.title}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <a href={`/api/v1/meetings/${meeting.id}/ics`}>
                            <Download /> Add to calendar (.ics)
                          </a>
                        </DropdownMenuItem>
                        {canWrite && meeting.status === "SCHEDULED" ? (
                          <>
                            <DropdownMenuItem onSelect={() => update.mutate({ id: meeting.id, status: "COMPLETED" })}>Mark completed</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => update.mutate({ id: meeting.id, status: "NO_SHOW" })}>Mark no-show</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => update.mutate({ id: meeting.id, status: "CANCELED" })}>Cancel</DropdownMenuItem>
                          </>
                        ) : null}
                        {canWrite && meeting.status !== "SCHEDULED" ? <DropdownMenuItem onSelect={() => update.mutate({ id: meeting.id, status: "SCHEDULED" })}>Mark as scheduled</DropdownMenuItem> : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {creating ? <MeetingDialog open onOpenChange={setCreating} lead={null} /> : null}
    </div>
  );
}

// ----------------------------------------------------------------------------- Contacts

interface ContactRow {
  id: string;
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  isPrimary: boolean;
  source: string;
  emailVerified: boolean | null;
  lead: { id: string; name: string; city: string | null; status: string };
}

export function ContactsTab() {
  const [q, setQ] = React.useState("");
  const contacts = useQuery({
    queryKey: ["contacts", q],
    queryFn: () => api<{ contacts: ContactRow[]; total: number }>(`/api/v1/contacts${q ? `?q=${encodeURIComponent(q)}` : ""}`),
    placeholderData: (previous) => previous,
  });
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search people, companies, emails…" className="w-full sm:w-80" />
        {contacts.data ? <span className="text-xs text-foreground-muted">{contacts.data.total} people</span> : null}
      </div>
      {contacts.isPending ? (
        <Skeleton className="h-64" />
      ) : contacts.isError ? (
        <ErrorState description={errorMessage(contacts.error)} onRetry={() => void contacts.refetch()} />
      ) : contacts.data.contacts.length === 0 ? (
        <EmptyState icon={Users} title="No contacts found" description="Enrichment adds the people it finds on company websites; you can add contacts on any lead." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full table-fixed text-left text-[13px]">
            <thead className="border-b border-border bg-surface-muted/60 text-[11px] font-medium text-foreground-muted">
              <tr>
                <th className="w-[34%] px-3 py-2 font-medium">Person</th>
                <th className="w-[26%] px-3 py-2 font-medium">Company</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">Reach</th>
                <th className="hidden w-32 px-3 py-2 font-medium lg:table-cell">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {contacts.data.contacts.map((contact) => (
                <tr key={contact.id} className="hover:bg-surface-muted/50">
                  <td className="px-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar name={contact.name ?? contact.email ?? "?"} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {contact.name ?? "Unnamed"}
                          {contact.isPrimary ? (
                            <Badge tone="accent" className="ml-1.5">
                              Primary
                            </Badge>
                          ) : null}
                        </p>
                        <p className="truncate text-[11px] text-foreground-muted">{contact.title ?? "—"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/app/leads/${contact.lead.id}`} className="flex min-w-0 items-center gap-2 hover:underline">
                      <CompanyMark name={contact.lead.name} className="size-5 text-[9px]" />
                      <span className="truncate">{contact.lead.name}</span>
                    </Link>
                  </td>
                  <td className="hidden px-3 py-2.5 md:table-cell">
                    <div className="grid min-w-0 gap-0.5 text-xs text-foreground-secondary">
                      {contact.email ? (
                        <a href={`mailto:${contact.email}`} className="inline-flex min-w-0 items-center gap-1.5 hover:underline">
                          <Mail className="size-3 shrink-0" /> <span className="truncate">{contact.email}</span>
                          {contact.emailVerified ? <span className="text-[10px] text-success-text">verified</span> : null}
                        </a>
                      ) : null}
                      {contact.phone ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Phone className="size-3 shrink-0" /> {contact.phone}
                        </span>
                      ) : null}
                      {!contact.email && !contact.phone ? <span className="text-foreground-subtle">No contact details</span> : null}
                    </div>
                  </td>
                  <td className="hidden truncate px-3 py-2.5 text-xs text-foreground-muted lg:table-cell">{contact.source.startsWith("mock") ? "Demo data" : contact.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
