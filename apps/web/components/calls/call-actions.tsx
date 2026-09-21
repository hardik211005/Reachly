"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Phone, PhoneCall, PhoneOff } from "lucide-react";
import { CALL_OUTCOME_LABELS, CALL_OUTCOMES, type CallOutcome } from "@repo/config";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Label,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";

function invalidateCalls(queryClient: ReturnType<typeof useQueryClient>, callId: string) {
  void queryClient.invalidateQueries({ queryKey: ["call", callId] });
  void queryClient.invalidateQueries({ queryKey: ["calls"] });
  void queryClient.invalidateQueries({ queryKey: ["call-stats"] });
  void queryClient.invalidateQueries({ queryKey: ["inbox-summary"] });
}

/** Starting a call always goes through an explicit confirmation. */
export function StartCallButton({
  call,
  simulated,
  announceAi,
  navigate = false,
  size = "sm",
}: {
  call: { id: string; type: "AI_AGENT" | "MANUAL"; toNumber: string | null; lead: { name: string }; brief: { opening?: string } | null };
  simulated: boolean;
  announceAi: boolean;
  navigate?: boolean;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState(false);
  const start = useMutation({
    mutationFn: () => api<{ status: string; scheduledFor: string | null }>(`/api/v1/calls/${call.id}/start`, { method: "POST", json: { confirm: true } }),
    onSuccess: (result) => {
      setOpen(false);
      if (result.scheduledFor) toast.success(`Outside calling hours — scheduled for ${new Date(result.scheduledFor).toLocaleString()}`);
      else toast.success(call.type === "AI_AGENT" ? `Calling ${call.lead.name}…` : "Call started — log the outcome when you hang up");
      invalidateCalls(queryClient, call.id);
      if (navigate) router.push(`/app/calls/${call.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const ai = call.type === "AI_AGENT";
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setConfirmed(false);
      }}
    >
      <Button variant="primary" size={size} onClick={() => setOpen(true)}>
        {ai ? <PhoneCall /> : <Phone />} {ai ? "Start AI call" : "Start call"}
      </Button>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{ai ? `Let the AI agent call ${call.lead.name}?` : `Call ${call.lead.name}`}</DialogTitle>
          <DialogDescription>
            {ai ? "The agent follows the brief, answers objections honestly and aims to book a short meeting." : "Dial from your phone. When you hang up, log what happened so follow-ups are created."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-[13px]">
          <div className="rounded-md border border-border px-3 py-2">
            <p className="text-xs text-foreground-muted">Number</p>
            <p className="font-medium tabular">{call.toNumber ?? "—"}</p>
          </div>
          {ai && call.brief?.opening ? (
            <div className="rounded-md border border-border px-3 py-2">
              <p className="text-xs text-foreground-muted">The agent opens with</p>
              <p className="mt-0.5 leading-relaxed text-foreground-secondary">“{call.brief.opening}”</p>
            </div>
          ) : null}
          {ai && simulated ? (
            <p className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning-text">
              <FlaskConical className="mt-0.5 size-3.5 shrink-0" /> Demo voice provider: nobody is dialled. The conversation is simulated and labelled as such.
            </p>
          ) : null}
          {ai ? (
            <label className="flex items-start gap-2.5">
              <Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} className="mt-0.5" />
              <span className="text-xs leading-relaxed text-foreground-secondary">
                I confirm this business may be called{announceAi ? ", and the agent will say it's an AI assistant" : ""}. They’re suppressed automatically if they ask not to be called.
              </span>
            </label>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={(ai && !confirmed) || start.isPending} onClick={() => start.mutate()}>
            {ai ? <PhoneCall /> : <Phone />} {start.isPending ? "Starting…" : ai ? "Call now" : "I'm dialling"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CancelCallButton({ callId }: { callId: string }) {
  const queryClient = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => api(`/api/v1/calls/${callId}/cancel`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Call canceled");
      invalidateCalls(queryClient, callId);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
      Cancel call
    </Button>
  );
}

export function HangUpButton({ callId }: { callId: string }) {
  const queryClient = useQueryClient();
  const hangUp = useMutation({
    mutationFn: () => api(`/api/v1/calls/${callId}/hangup`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Ending the call…");
      invalidateCalls(queryClient, callId);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Button size="sm" variant="danger" disabled={hangUp.isPending} onClick={() => hangUp.mutate()}>
      <PhoneOff /> End call
    </Button>
  );
}

/** Outcome form for calls a person made from their own phone. */
export function LogOutcomeForm({ callId }: { callId: string }) {
  const queryClient = useQueryClient();
  const [reached, setReached] = React.useState<"yes" | "no">("yes");
  const [outcome, setOutcome] = React.useState<CallOutcome>("INTERESTED");
  const [minutes, setMinutes] = React.useState("3");
  const [notes, setNotes] = React.useState("");
  const log = useMutation({
    mutationFn: () => api(`/api/v1/calls/${callId}/log`, { method: "POST", json: { reached: reached === "yes", outcome, durationMinutes: Number(minutes) || 0, notes } }),
    onSuccess: () => {
      toast.success("Call logged — follow-ups created");
      invalidateCalls(queryClient, callId);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <section className="rounded-lg border border-accent/40 bg-surface p-4 shadow-xs">
      <h3 className="text-[13px] font-semibold">How did it go?</h3>
      <p className="mt-0.5 text-xs text-foreground-muted">Your answer updates the lead, creates follow-up tasks and suppresses them if they asked not to be called.</p>
      <div className="mt-3 grid gap-3">
        <SegmentedControl
          size="sm"
          value={reached}
          onValueChange={setReached}
          options={[
            { value: "yes", label: "We spoke" },
            { value: "no", label: "No answer" },
          ]}
        />
        {reached === "yes" ? (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px]">
            <Field>
              <Label>Outcome</Label>
              <Select value={outcome} onValueChange={(value) => setOutcome(value as CallOutcome)}>
                <SelectTrigger aria-label="Outcome">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CALL_OUTCOMES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {CALL_OUTCOME_LABELS[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <Label htmlFor="call-minutes">Minutes</Label>
              <Input id="call-minutes" type="number" min={0} max={240} value={minutes} onChange={(event) => setMinutes(event.target.value)} />
            </Field>
          </div>
        ) : null}
        <Field>
          <Label htmlFor="call-notes">Notes</Label>
          <Textarea id="call-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What did they say? Any objections, timing or next step?" />
        </Field>
        <div className="flex justify-end">
          <Button variant="primary" size="sm" disabled={log.isPending} onClick={() => log.mutate()}>
            Save outcome
          </Button>
        </div>
      </div>
    </section>
  );
}
