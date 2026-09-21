"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  Ban,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  Database,
  ExternalLink,
  FileText,
  Globe,
  ListTodo,
  Mail,
  MapPin,
  MoreHorizontal,
  Phone,
  Plus,
  RefreshCw,
  Sparkles,
  Star,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { EVENT_LABELS, LEAD_STATUS_LABELS, LEAD_STATUSES, eventTone, type LeadStatus } from "@repo/config";
import {
  Avatar,
  Badge,
  Button,
  Callout,
  CompanyMark,
  DescriptionList,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  Input,
  Label,
  ScoreBar,
  ScoreIndicator,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Timeline,
  cn,
  toast,
  type TimelineItem,
} from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { useCanWrite } from "../shell/shell-context";
import { LocalTime, RelativeTime } from "../time";
import { AddToCampaignMenu, FitBadge, LeadStatusBadge, SourceLabel, type LeadSignalView } from "./shared";

// ----------------------------------------------------------------------------- Types (serialised Prisma rows)

interface Contact {
  id: string;
  kind: "PERSON" | "GENERIC";
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  isPrimary: boolean;
  source: string;
  whatsappOptIn: boolean;
}

interface Factor {
  factor: string;
  label: string;
  score: number;
  weight: number;
  reasons: string[];
}

interface LeadScoreRow {
  id: string;
  total: number;
  fitTier: "HIGH" | "MEDIUM" | "LOW";
  qualification: string;
  breakdown: { factors: Factor[]; adjustments: Array<{ label: string; points: number }> };
  reasoning: string | null;
  scoringVersion: string;
  createdAt: string;
}

export interface LeadDetail {
  id: string;
  name: string;
  category: string | null;
  industry: string | null;
  description: string | null;
  website: string | null;
  domain: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  locality: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  rating: string | null;
  reviewCount: number | null;
  priceLevel: number | null;
  openingHours: string[] | null;
  locationsCount: number | null;
  employeeRange: string | null;
  socialProfiles: Record<string, string>;
  services: string[];
  signals: LeadSignalView[];
  status: LeadStatus;
  score: number | null;
  fitTier: "HIGH" | "MEDIUM" | "LOW" | null;
  qualification: string | null;
  enrichmentStatus: string;
  sourceType: string;
  sourceProvider: string;
  doNotContact: boolean;
  tags: string[];
  aiSummary: string | null;
  lastActivityAt: string | null;
  nextAction: string | null;
  createdAt: string;
  owner: { id: string; name: string } | null;
  contacts: Contact[];
  sources: Array<{ id: string; provider: string; sourceType: string; externalId: string | null; url: string | null; rawData: unknown; fetchedAt: string }>;
  scores: LeadScoreRow[];
  campaignLeads: Array<{ id: string; status: string; addedAt: string; campaign: { id: string; name: string; status: string } }>;
  tasks: Array<{ id: string; title: string; type: string; priority: string; dueAt: string | null; status: string; assignee: { name: string } | null }>;
  deals: Array<{ id: string; title: string; stage: string; value: string; currency: string }>;
}

interface TimelineEvent {
  id: string;
  type: string;
  occurredAt: string;
  channel: string | null;
  properties: Record<string, unknown>;
}

interface NoteRow {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string } | null;
}

function humanize(value: string | null | undefined): string {
  return value ? value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—";
}

function eventDescription(event: TimelineEvent): string | undefined {
  const p = event.properties;
  switch (event.type) {
    case "lead_created":
      return p.source === "discovery" ? `Found via ${p.provider === "mock" ? "demo data" : String(p.provider)}` : `Source: ${String(p.source ?? "manual")}`;
    case "lead_enriched":
      return `${Number(p.contactsAdded ?? 0)} contact detail(s) found · signals: ${((p.signals as string[] | undefined) ?? []).map((s) => s.replace(/_/g, " ")).join(", ") || "none"}`;
    case "lead_scored":
      return `Score ${String(p.total)} · ${humanize(String(p.qualification ?? ""))}${p.ai ? " · with AI qualification" : ""}`;
    case "lead_status_changed":
      return `${String(p.fromLabel ?? p.from)} → ${String(p.toLabel ?? p.to)}`;
    case "lead_added_to_campaign":
      return String(p.campaign ?? "");
    case "note_added":
      return String(p.preview ?? "");
    case "task_created":
    case "task_completed":
      return String(p.title ?? "");
    default:
      return undefined;
  }
}

// ----------------------------------------------------------------------------- Score breakdown

function ScoreBreakdown({ score }: { score: LeadScoreRow | undefined }) {
  const [expanded, setExpanded] = React.useState<string | null>(null);
  if (!score) return <EmptyState compact title="Not scored yet" description="Scores appear once enrichment finishes." />;
  return (
    <div className="grid gap-3">
      {score.breakdown.factors.map((factor) => (
        <div key={factor.factor}>
          <button type="button" className="w-full text-left" onClick={() => setExpanded(expanded === factor.factor ? null : factor.factor)}>
            <ScoreBar label={factor.label} score={factor.score} weight={factor.weight} />
          </button>
          {expanded === factor.factor ? (
            <ul className="mt-1.5 grid gap-1 pl-1 animate-fade-in">
              {factor.reasons.map((reason, index) => (
                <li key={index} className={cn("flex gap-1.5 text-xs", reason.startsWith("AI") ? "text-accent-soft-foreground" : "text-foreground-muted")}>
                  <span aria-hidden>•</span> {reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
      {score.breakdown.adjustments.length ? (
        <div className="border-t border-border pt-2 text-xs text-foreground-muted">
          {score.breakdown.adjustments.map((adjustment) => (
            <p key={adjustment.label}>
              Rule “{adjustment.label}”: {adjustment.points > 0 ? "+" : ""}
              {adjustment.points}
            </p>
          ))}
        </div>
      ) : null}
      <p className="text-[11px] text-foreground-subtle">
        Scored <RelativeTime value={score.createdAt} /> · {score.scoringVersion.includes("ai") ? "rules + AI qualification" : "rules only"} · click a factor for reasons
      </p>
    </div>
  );
}

// ----------------------------------------------------------------------------- Contacts

function ContactsPanel({ lead }: { lead: LeadDetail }) {
  const router = useRouter();
  const canWrite = useCanWrite();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", title: "", email: "", phone: "" });
  const add = useMutation({
    mutationFn: () =>
      api(`/api/v1/leads/${lead.id}/contacts`, {
        method: "POST",
        json: { name: form.name || null, title: form.title || null, email: form.email || null, phone: form.phone || null },
      }),
    onSuccess: () => {
      setOpen(false);
      setForm({ name: "", title: "", email: "", phone: "" });
      router.refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/v1/contacts/${id}`, { method: "DELETE" }),
    onSuccess: () => router.refresh(),
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="grid gap-3">
      {lead.contacts.length === 0 ? <EmptyState compact icon={Users} title="No contacts yet" description="Enrichment adds contact details it finds; you can also add them manually." /> : null}
      {lead.contacts.map((contact) => (
        <div key={contact.id} className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3">
          <Avatar name={contact.name ?? contact.email ?? "?"} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium">
              {contact.name ?? (contact.kind === "GENERIC" ? "Business line" : "Unnamed")}
              {contact.title ? <span className="font-normal text-foreground-muted"> · {contact.title}</span> : null}
              {contact.isPrimary ? <Badge tone="accent" className="ml-2">Primary</Badge> : null}
            </p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-secondary">
              {contact.email ? (
                <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1 hover:underline">
                  <Mail className="size-3" /> {contact.email}
                </a>
              ) : null}
              {contact.phone ? (
                <span className="inline-flex items-center gap-1">
                  <Phone className="size-3" /> {contact.phone}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-[11px] text-foreground-subtle">Source: {contact.source === "mock-website" ? "demo website (simulated)" : contact.source}</p>
          </div>
          {canWrite ? (
            <Button variant="ghost" size="icon-xs" aria-label="Remove contact" onClick={() => remove.mutate(contact.id)}>
              <Trash2 />
            </Button>
          ) : null}
        </div>
      ))}
      {canWrite ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="justify-self-start">
              <Plus /> Add contact
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add contact</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              {(["name", "title", "email", "phone"] as const).map((key) => (
                <Field key={key}>
                  <Label htmlFor={`contact-${key}`}>{humanize(key)}</Label>
                  <Input id={`contact-${key}`} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} />
                </Field>
              ))}
            </div>
            <DialogFooter>
              <Button variant="primary" onClick={() => add.mutate()} loading={add.isPending}>
                Save contact
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------------------- Activity + notes

function ActivityPanel({ leadId, initial }: { leadId: string; initial: { events: TimelineEvent[]; notes: NoteRow[] } }) {
  const timeline = useQuery({
    queryKey: ["lead-timeline", leadId],
    queryFn: () => api<{ events: TimelineEvent[]; notes: NoteRow[] }>(`/api/v1/leads/${leadId}/timeline`),
    initialData: initial,
  });
  const items: TimelineItem[] = [
    ...timeline.data.events.map((event) => ({
      id: event.id,
      at: new Date(event.occurredAt),
      item: {
        id: event.id,
        time: <LocalTime value={event.occurredAt} />,
        title: EVENT_LABELS[event.type] ?? humanize(event.type),
        description: eventDescription(event),
        tone: eventTone(event.type),
        icon: event.type.startsWith("email") ? Mail : event.type.startsWith("call") ? Phone : event.type.includes("score") || event.type.includes("qualif") ? Sparkles : Activity,
      } satisfies TimelineItem,
    })),
    ...timeline.data.notes.map((note) => ({
      id: note.id,
      at: new Date(note.createdAt),
      item: {
        id: `note-${note.id}`,
        time: <LocalTime value={note.createdAt} />,
        title: `Note by ${note.author?.name ?? "someone"}`,
        description: <p className="whitespace-pre-wrap">{note.body}</p>,
        icon: FileText,
      } satisfies TimelineItem,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .map((entry) => entry.item);

  return items.length ? <Timeline items={items} /> : <EmptyState compact icon={Activity} title="No activity yet" />;
}

function NotesComposer({ leadId }: { leadId: string }) {
  const queryClient = useQueryClient();
  const [body, setBody] = React.useState("");
  const add = useMutation({
    mutationFn: () => api(`/api/v1/leads/${leadId}/notes`, { method: "POST", json: { body } }),
    onSuccess: () => {
      setBody("");
      void queryClient.invalidateQueries({ queryKey: ["lead-timeline", leadId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <div className="grid gap-2 rounded-lg border border-border bg-surface p-3">
      <Textarea rows={2} placeholder="Add a note for your team…" value={body} onChange={(event) => setBody(event.target.value)} className="border-0 px-0 shadow-none focus-visible:ring-0" />
      <div className="flex justify-end">
        <Button size="sm" variant="primary" disabled={!body.trim()} loading={add.isPending} onClick={() => add.mutate()}>
          Add note
        </Button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- Tasks

function TasksPanel({ lead }: { lead: LeadDetail }) {
  const router = useRouter();
  const canWrite = useCanWrite();
  const [title, setTitle] = React.useState("");
  const [due, setDue] = React.useState("");
  const create = useMutation({
    mutationFn: () => api("/api/v1/tasks", { method: "POST", json: { title, leadId: lead.id, type: "FOLLOW_UP", dueAt: due ? new Date(due).toISOString() : null } }),
    onSuccess: () => {
      setTitle("");
      setDue("");
      router.refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const complete = useMutation({
    mutationFn: (id: string) => api(`/api/v1/tasks/${id}`, { method: "PATCH", json: { status: "DONE" } }),
    onSuccess: () => router.refresh(),
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <div className="grid gap-3">
      {canWrite ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim()) create.mutate();
          }}
        >
          <Input className="min-w-48 flex-1" placeholder="Follow up about pricing…" value={title} onChange={(event) => setTitle(event.target.value)} />
          <Input type="date" className="w-40" value={due} onChange={(event) => setDue(event.target.value)} aria-label="Due date" />
          <Button type="submit" loading={create.isPending} disabled={!title.trim()}>
            <Plus /> Add task
          </Button>
        </form>
      ) : null}
      {lead.tasks.length === 0 ? <EmptyState compact icon={ListTodo} title="No open tasks" /> : null}
      <ul className="grid gap-1.5">
        {lead.tasks.map((task) => {
          const overdue = task.dueAt && new Date(task.dueAt) < new Date();
          return (
            <li key={task.id} className="flex items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-2">
              <button type="button" aria-label="Mark done" onClick={() => complete.mutate(task.id)} disabled={!canWrite} className="text-foreground-muted hover:text-success-text">
                <Circle className="size-4" />
              </button>
              <span className="flex-1 text-[13px]">{task.title}</span>
              {task.dueAt ? (
                <span className={cn("inline-flex items-center gap-1 text-xs", overdue ? "text-danger-text" : "text-foreground-muted")}>
                  <Clock className="size-3" /> <LocalTime value={task.dueAt} style="date" />
                </span>
              ) : null}
              {task.assignee ? <Avatar name={task.assignee.name} size="xs" /> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ----------------------------------------------------------------------------- Workspace

export function LeadWorkspace({ lead, timeline }: { lead: LeadDetail; timeline: { events: TimelineEvent[]; notes: NoteRow[] } }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const latestScore = lead.scores[0];

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/api/v1/leads/${lead.id}`, { method: "PATCH", json: body }),
    onSuccess: () => {
      router.refresh();
      void queryClient.invalidateQueries({ queryKey: ["lead-timeline", lead.id] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const rescore = useMutation({
    mutationFn: () => api<{ total: number }>(`/api/v1/leads/${lead.id}/score`, { method: "POST", json: {} }),
    onSuccess: (result) => {
      toast.success(`Re-scored: ${result.total}`);
      router.refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const enrich = useMutation({
    mutationFn: () => api(`/api/v1/leads/${lead.id}/enrich`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Enrichment finished");
      router.refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const dnc = useMutation({
    mutationFn: () => api("/api/v1/leads/bulk", { method: "POST", json: { action: "do_not_contact", ids: [lead.id] } }),
    onSuccess: () => {
      toast.success("Marked do-not-contact — all outreach stopped");
      router.refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/v1/leads/${lead.id}`, { method: "DELETE" }),
    onSuccess: () => router.push("/app/leads"),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const socials = Object.entries(lead.socialProfiles ?? {});

  return (
    <div className="grid gap-6">
      <div>
        <Link href="/app/leads" className="mb-3 inline-flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground">
          <ArrowLeft className="size-3" /> Leads
        </Link>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <CompanyMark name={lead.name} className="size-11 text-sm" />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-[-0.01em]">{lead.name}</h1>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-foreground-muted">
                <span>{humanize(lead.category)}</span>
                {lead.locality || lead.city ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3" /> {[lead.locality, lead.city].filter(Boolean).join(", ")}
                  </span>
                ) : null}
                {lead.reviewCount ? (
                  <span className="inline-flex items-center gap-1">
                    <Star className="size-3" /> {lead.rating ?? "–"} · {lead.reviewCount} reviews
                  </span>
                ) : null}
                <SourceLabel provider={lead.sourceProvider} />
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <LeadStatusBadge status={lead.status} />
                <FitBadge tier={lead.fitTier} />
                {lead.tags.map((tag) => (
                  <Badge key={tag} tone="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {canWrite && !lead.doNotContact ? (
              <Select value={lead.status} onValueChange={(status) => patch.mutate({ status })}>
                <SelectTrigger className="h-8 w-40" aria-label="Status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_STATUSES.filter((status) => status !== "DO_NOT_CONTACT").map((status) => (
                    <SelectItem key={status} value={status}>
                      {LEAD_STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {canWrite && !lead.doNotContact ? <AddToCampaignMenu leadIds={[lead.id]} onDone={() => router.refresh()} /> : null}
            {canWrite ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="icon" aria-label="More actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => rescore.mutate()}>
                    <RefreshCw /> Re-score
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => enrich.mutate()}>
                    <Database /> Re-enrich
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {!lead.doNotContact ? (
                    <DropdownMenuItem destructive onSelect={() => window.confirm("Mark as do-not-contact? All outreach to this business stops.") && dnc.mutate()}>
                      <Ban /> Mark do-not-contact
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem destructive onSelect={() => window.confirm("Delete this lead?") && remove.mutate()}>
                    <Trash2 /> Delete lead
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      </div>

      {lead.doNotContact ? (
        <Callout tone="danger" icon={Ban} title="Do not contact">
          This business is on your do-not-contact list. It is excluded from every campaign and channel.
        </Callout>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Tabs defaultValue="overview" className="min-w-0">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="activity">
              <Activity /> Activity
            </TabsTrigger>
            <TabsTrigger value="contacts">
              <UserRound /> Contacts <span className="text-foreground-subtle">{lead.contacts.length}</span>
            </TabsTrigger>
            <TabsTrigger value="tasks">
              <ListTodo /> Tasks <span className="text-foreground-subtle">{lead.tasks.length}</span>
            </TabsTrigger>
            <TabsTrigger value="sources">
              <Database /> Sources
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="grid gap-4 pt-4">
            {lead.aiSummary ? (
              <Callout tone="accent" icon={Sparkles} title="Why this lead">
                {lead.aiSummary}
              </Callout>
            ) : null}
            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-lg border border-border bg-surface p-4">
                <h3 className="mb-3 text-[13px] font-semibold">Buying signals</h3>
                {lead.signals.length === 0 ? (
                  <p className="text-[13px] text-foreground-muted">No signals detected yet.</p>
                ) : (
                  <ul className="grid gap-2.5">
                    {[...lead.signals].sort((a, b) => b.weight - a.weight).map((signal) => (
                      <li key={signal.key} className="flex items-start gap-2">
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success-text" />
                        <div>
                          <p className="text-[13px] font-medium">{signal.label}</p>
                          <p className="text-xs text-foreground-muted">
                            {signal.evidence} · source: {signal.source === "mock-website" ? "demo website (simulated)" : signal.source}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="rounded-lg border border-border bg-surface p-4">
                <h3 className="mb-3 text-[13px] font-semibold">Company</h3>
                <DescriptionList
                  items={[
                    {
                      label: "Website",
                      value: lead.website ? (
                        <a href={lead.website} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-accent hover:underline">
                          <Globe className="size-3" /> {lead.domain ?? lead.website} <ExternalLink className="size-3" />
                        </a>
                      ) : null,
                    },
                    { label: "Phone", value: lead.phone },
                    { label: "Email", value: lead.email },
                    { label: "Address", value: lead.address },
                    { label: "Locations", value: lead.locationsCount ? String(lead.locationsCount) : null },
                    { label: "Team size", value: lead.employeeRange },
                    { label: "Industry", value: lead.industry },
                    { label: "Offers", value: lead.services.length ? lead.services.join(", ") : null },
                    { label: "Social", value: socials.length ? socials.map(([network]) => humanize(network)).join(", ") : null },
                    { label: "Hours", value: lead.openingHours?.join("; ") ?? null },
                  ]}
                />
              </section>
            </div>
            {lead.description ? <p className="text-[13px] leading-relaxed text-foreground-secondary">{lead.description}</p> : null}
          </TabsContent>

          <TabsContent value="activity" className="grid gap-4 pt-4">
            {canWrite ? <NotesComposer leadId={lead.id} /> : null}
            <ActivityPanel leadId={lead.id} initial={timeline} />
          </TabsContent>

          <TabsContent value="contacts" className="pt-4">
            <ContactsPanel lead={lead} />
          </TabsContent>

          <TabsContent value="tasks" className="pt-4">
            <TasksPanel lead={lead} />
          </TabsContent>

          <TabsContent value="sources" className="grid gap-3 pt-4">
            <p className="text-[13px] text-foreground-muted">Every place this business was found, with the raw data received — nothing about a lead is untraceable.</p>
            {lead.sources.map((source) => (
              <details key={source.id} className="rounded-lg border border-border bg-surface">
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-[13px]">
                  <ChevronDown className="size-3.5 text-foreground-muted" />
                  <SourceLabel provider={source.provider} />
                  <span className="text-foreground-muted">· {humanize(source.sourceType)}</span>
                  <LocalTime value={source.fetchedAt} className="ml-auto text-xs text-foreground-subtle" />
                </summary>
                <pre className="max-h-80 overflow-auto border-t border-border bg-surface-muted px-3 py-2 font-mono text-[11px] leading-relaxed">{JSON.stringify(source.rawData, null, 2)}</pre>
              </details>
            ))}
          </TabsContent>
        </Tabs>

        <aside className="grid content-start gap-4">
          <section className="rounded-lg border border-border bg-surface p-4">
            <div className="mb-4 flex items-center gap-3">
              <ScoreIndicator score={lead.score} size="lg" />
              <div>
                <p className="text-[13px] font-semibold">Lead score</p>
                <p className="text-xs text-foreground-muted">{lead.qualification ? humanize(lead.qualification) : "Pending"}</p>
              </div>
            </div>
            <ScoreBreakdown score={latestScore} />
          </section>
          <section className="rounded-lg border border-border bg-surface p-4">
            <h3 className="mb-3 text-[13px] font-semibold">Details</h3>
            <DescriptionList
              items={[
                { label: "Owner", value: lead.owner?.name ?? null },
                { label: "Added", value: <RelativeTime value={lead.createdAt} /> },
                { label: "Last activity", value: lead.lastActivityAt ? <RelativeTime value={lead.lastActivityAt} /> : null },
                { label: "Enrichment", value: humanize(lead.enrichmentStatus) },
              ]}
            />
          </section>
          <section className="rounded-lg border border-border bg-surface p-4">
            <h3 className="mb-3 text-[13px] font-semibold">Campaigns</h3>
            {lead.campaignLeads.length === 0 ? (
              <p className="text-[13px] text-foreground-muted">Not in any campaign.</p>
            ) : (
              <ul className="grid gap-2">
                {lead.campaignLeads.map((membership) => (
                  <li key={membership.id} className="flex items-center justify-between gap-2 text-[13px]">
                    <Link href={`/app/campaigns/${membership.campaign.id}`} className="truncate hover:underline">
                      {membership.campaign.name}
                    </Link>
                    <Badge tone="neutral">{humanize(membership.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
