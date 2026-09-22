"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trophy, XCircle } from "lucide-react";
import { DEAL_LOST_REASONS, DEAL_STAGE_LABELS, TASK_TYPE_LABELS, TASK_TYPES, type DealStage, type TaskType } from "@repo/config";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldHint,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  cn,
  toast,
} from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { LeadPicker, StageDot, useCrm } from "./shared";

const OPEN_STAGES: DealStage[] = ["NEW", "QUALIFIED", "CONTACTED", "INTERESTED", "MEETING", "PROPOSAL", "NEGOTIATION"];

function toDateInput(value: Date): string {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function toDateTimeInput(value: Date): string {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/** Refreshes everything CRM-shaped after a change. */
export function useInvalidateCrm() {
  const queryClient = useQueryClient();
  return React.useCallback(() => {
    for (const key of ["pipeline", "deal", "tasks", "meetings", "quotes", "lead-deals", "inbox-summary", "lead-timeline"]) void queryClient.invalidateQueries({ queryKey: [key] });
  }, [queryClient]);
}

// ----------------------------------------------------------------------------- New deal

export function NewDealDialog({
  open,
  onOpenChange,
  stage: initialStage = "NEW",
  lead: fixedLead,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stage?: DealStage;
  lead?: { id: string; name: string } | null;
  onCreated?: (id: string) => void;
}) {
  const { members, currency } = useCrm();
  const invalidate = useInvalidateCrm();
  const [lead, setLead] = React.useState<{ id: string; name: string } | null>(fixedLead ?? null);
  const [title, setTitle] = React.useState("");
  const [value, setValue] = React.useState("");
  const [stage, setStage] = React.useState<DealStage>(initialStage);
  const [closeDate, setCloseDate] = React.useState("");
  const [ownerId, setOwnerId] = React.useState<string>("");

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/api/v1/deals", {
        method: "POST",
        json: { leadId: lead?.id, title: title.trim() || undefined, value: Number(value) || 0, stage, expectedCloseDate: closeDate ? new Date(closeDate).toISOString() : null, ownerId: ownerId || null },
      }),
    onSuccess: (deal) => {
      toast.success(`Deal added to ${DEAL_STAGE_LABELS[stage]}`);
      invalidate();
      onOpenChange(false);
      onCreated?.(deal.id);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New deal</DialogTitle>
          <DialogDescription>Track an opportunity with a company. Deals also appear automatically when a lead gets interested, books a meeting or receives a quote.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {fixedLead ? null : (
            <Field>
              <Label>Company</Label>
              <LeadPicker value={lead?.id ?? null} onChange={(picked) => setLead({ id: picked.id, name: picked.name })} enabled={open} autoFocus />
            </Field>
          )}
          <div className="grid items-start gap-3 sm:grid-cols-2">
            <Field className="sm:col-span-2">
              <Label htmlFor="deal-title">Deal name</Label>
              <Input id="deal-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={lead ? `${lead.name} — website + social` : "e.g. Website + social media"} />
            </Field>
            <Field>
              <Label htmlFor="deal-value">Value ({currency})</Label>
              <Input id="deal-value" type="number" min={0} inputMode="numeric" value={value} onChange={(event) => setValue(event.target.value)} placeholder="0" />
              <FieldHint>Before tax. A sent quote updates it.</FieldHint>
            </Field>
            <Field>
              <Label>Stage</Label>
              <Select value={stage} onValueChange={(next) => setStage(next as DealStage)}>
                <SelectTrigger aria-label="Stage">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPEN_STAGES.map((item) => (
                    <SelectItem key={item} value={item}>
                      <span className="inline-flex items-center gap-2">
                        <StageDot stage={item} /> {DEAL_STAGE_LABELS[item]}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <Label htmlFor="deal-close">Expected close</Label>
              <Input id="deal-close" type="date" value={closeDate} min={toDateInput(new Date())} onChange={(event) => setCloseDate(event.target.value)} />
            </Field>
            <Field>
              <Label>Owner</Label>
              <Select value={ownerId || "lead-owner"} onValueChange={(next) => setOwnerId(next === "lead-owner" ? "" : next)}>
                <SelectTrigger aria-label="Owner">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead-owner">Lead owner (or me)</SelectItem>
                  {members.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!lead} loading={create.isPending} onClick={() => create.mutate()}>
            Create deal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------- Won / lost

export function WonDialog({ deal, onConfirm, onCancel, pending }: { deal: { title: string; value: number; currency: string } | null; onConfirm: (value: number) => void; onCancel: () => void; pending: boolean }) {
  const [value, setValue] = React.useState(deal ? String(deal.value || "") : "");
  return (
    <Dialog open={deal !== null} onOpenChange={(open) => (open ? null : onCancel())}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="size-4 text-good" /> Mark as won
          </DialogTitle>
          <DialogDescription>Confirm the value you closed “{deal?.title}” at. Won revenue feeds your analytics.</DialogDescription>
        </DialogHeader>
        <Field>
          <Label htmlFor="won-value">Closed value ({deal?.currency ?? "INR"}, before tax)</Label>
          <Input id="won-value" type="number" min={0} value={value} onChange={(event) => setValue(event.target.value)} autoFocus />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={() => onConfirm(Number(value) || 0)}>
            Mark won
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LostDialog({ deal, onConfirm, onCancel, pending }: { deal: { title: string } | null; onConfirm: (reason: string) => void; onCancel: () => void; pending: boolean }) {
  const [choice, setChoice] = React.useState<string | null>(null);
  const [other, setOther] = React.useState("");
  const reason = choice === "Other" ? other.trim() : choice;
  return (
    <Dialog open={deal !== null} onOpenChange={(open) => (open ? null : onCancel())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="size-4 text-critical" /> Why was it lost?
          </DialogTitle>
          <DialogDescription>“{deal?.title}”. Loss reasons power your win/loss insights — the most useful thing to learn from a no.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Loss reason">
          {[...DEAL_LOST_REASONS, "Other"].map((item) => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={choice === item}
              onClick={() => setChoice(item)}
              className={cn("h-7 rounded-full border px-3 text-xs font-medium transition-colors", choice === item ? "border-foreground bg-foreground text-background" : "border-border bg-surface text-foreground-secondary hover:border-border-strong")}
            >
              {item}
            </button>
          ))}
        </div>
        {choice === "Other" ? <Textarea rows={2} value={other} onChange={(event) => setOther(event.target.value)} placeholder="What happened?" aria-label="Other reason" autoFocus /> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!reason} loading={pending} onClick={() => reason && onConfirm(reason)}>
            Mark lost
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------- Meeting & task

export function MeetingDialog({ open, onOpenChange, lead, dealId }: { open: boolean; onOpenChange: (open: boolean) => void; lead: { id: string; name: string } | null; dealId?: string | null }) {
  const invalidate = useInvalidateCrm();
  const [picked, setPicked] = React.useState<{ id: string; name: string } | null>(lead);
  const [title, setTitle] = React.useState(lead ? `Intro call with ${lead.name}` : "");
  const [when, setWhen] = React.useState(() => {
    const next = new Date(Date.now() + 86_400_000);
    next.setHours(11, 0, 0, 0);
    return toDateTimeInput(next);
  });
  const [duration, setDuration] = React.useState("30");
  const [location, setLocation] = React.useState("");
  const target = lead ?? picked;
  const create = useMutation({
    mutationFn: () =>
      api("/api/v1/meetings", {
        method: "POST",
        json: { leadId: target?.id, dealId: dealId ?? null, title: title.trim() || `Meeting with ${target?.name}`, scheduledAt: new Date(when).toISOString(), durationMinutes: Number(duration), location: location.trim() || null },
      }),
    onSuccess: () => {
      toast.success("Meeting booked");
      invalidate();
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Schedule a meeting</DialogTitle>
          <DialogDescription>Booking a meeting moves the lead and its deal to Meeting. Download the invite to add it to your calendar.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {lead ? null : (
            <Field>
              <Label>Company</Label>
              <LeadPicker
                value={picked?.id ?? null}
                onChange={(item) => {
                  setPicked({ id: item.id, name: item.name });
                  if (!title) setTitle(`Intro call with ${item.name}`);
                }}
                enabled={open}
              />
            </Field>
          )}
          <Field>
            <Label htmlFor="meeting-title">Title</Label>
            <Input id="meeting-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <Field>
              <Label htmlFor="meeting-when">When</Label>
              <Input id="meeting-when" type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} />
            </Field>
            <Field>
              <Label>Duration</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger aria-label="Duration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["15", "30", "45", "60", "90"].map((minutes) => (
                    <SelectItem key={minutes} value={minutes}>
                      {minutes} min
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field>
            <Label htmlFor="meeting-location">Location or link</Label>
            <Input id="meeting-location" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Google Meet, office address…" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!target || !when} loading={create.isPending} onClick={() => create.mutate()}>
            Book meeting
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TaskDialog({ open, onOpenChange, lead, dealId }: { open: boolean; onOpenChange: (open: boolean) => void; lead?: { id: string; name: string } | null; dealId?: string | null }) {
  const { members } = useCrm();
  const invalidate = useInvalidateCrm();
  const [title, setTitle] = React.useState("");
  const [type, setType] = React.useState<TaskType>("FOLLOW_UP");
  const [priority, setPriority] = React.useState("MEDIUM");
  const [due, setDue] = React.useState(() => toDateInput(new Date(Date.now() + 86_400_000)));
  const [assigneeId, setAssigneeId] = React.useState("me");
  const create = useMutation({
    mutationFn: () =>
      api("/api/v1/tasks", {
        method: "POST",
        json: { title: title.trim(), type, priority, dueAt: due ? new Date(`${due}T18:00:00`).toISOString() : null, leadId: lead?.id ?? null, dealId: dealId ?? null, assigneeId: assigneeId === "me" ? null : assigneeId },
      }),
    onSuccess: () => {
      toast.success("Task added");
      setTitle("");
      invalidate();
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New task{lead ? ` · ${lead.name}` : ""}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim()) create.mutate();
          }}
        >
          <Field>
            <Label htmlFor="task-title">What needs doing?</Label>
            <Input id="task-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Send the revised proposal" autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <Label>Type</Label>
              <Select value={type} onValueChange={(next) => setType(next as TaskType)}>
                <SelectTrigger aria-label="Type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_TYPES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {TASK_TYPE_LABELS[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger aria-label="Priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="LOW">Low</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <Label htmlFor="task-due">Due</Label>
              <Input id="task-due" type="date" value={due} onChange={(event) => setDue(event.target.value)} />
            </Field>
            <Field>
              <Label>Assignee</Label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger aria-label="Assignee">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="me">Me</SelectItem>
                  {members.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!title.trim()} loading={create.isPending}>
              Add task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

