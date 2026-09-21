"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Switch, toast } from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";

export interface CallingSettings {
  callingEnabled: boolean;
  callingConsentAttested: boolean;
  callingConsentAttestedAt: string | null;
  recordCalls: boolean;
  announceAiOnCalls: boolean;
  dndCheckEnabled: boolean;
}

function Row({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-start justify-between gap-4 py-3">
      <span>
        <span className="block text-[13px] font-medium">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-foreground-muted">{description}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5" />
    </label>
  );
}

/** Admin-only calling configuration, including the consent attestation (audited). */
export function CallingSetupDialog({ open, onOpenChange, settings }: { open: boolean; onOpenChange: (open: boolean) => void; settings: CallingSettings }) {
  const queryClient = useQueryClient();
  const [state, setState] = React.useState({
    callingEnabled: settings.callingEnabled,
    recordCalls: settings.recordCalls,
    announceAiOnCalls: settings.announceAiOnCalls,
    dndCheckEnabled: settings.dndCheckEnabled,
    attestConsent: settings.callingConsentAttested,
  });
  const save = useMutation({
    mutationFn: () => api("/api/v1/compliance/calling", { method: "PUT", json: state }),
    onSuccess: () => {
      toast.success("Calling settings saved");
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ["call-readiness"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const set = (patch: Partial<typeof state>) => setState((current) => ({ ...current, ...patch }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Calling setup</DialogTitle>
          <DialogDescription>How the AI voice agent may call your leads. Changes are recorded in the audit log.</DialogDescription>
        </DialogHeader>
        <div className="divide-y divide-border">
          <Row title="Enable AI calling" description="Allow AI voice calls from campaigns and the Calls page." checked={state.callingEnabled} onChange={(callingEnabled) => set({ callingEnabled })} />
          <Row title="Disclose that the caller is an AI" description="The agent says it's an AI assistant calling on your behalf. Required in many jurisdictions — keep it on." checked={state.announceAiOnCalls} onChange={(announceAiOnCalls) => set({ announceAiOnCalls })} />
          <Row title="Record calls" description="Store call recordings with your voice provider. Only enable if you inform callees and your local law allows it." checked={state.recordCalls} onChange={(recordCalls) => set({ recordCalls })} />
          <Row
            title="Require a DND registry check"
            description="Block real calls unless numbers are checked against a national do-not-disturb registry (e.g. India's NCPR). Your own suppression list is always checked."
            checked={state.dndCheckEnabled}
            onChange={(dndCheckEnabled) => set({ dndCheckEnabled })}
          />
        </div>
        <label className="flex items-start gap-2.5 rounded-md border border-border bg-surface-muted/50 p-3 text-[13px]">
          <Checkbox checked={state.attestConsent} onCheckedChange={(value) => set({ attestConsent: value === true })} className="mt-0.5" />
          <span>
            <span className="flex items-center gap-1.5 font-medium">
              <ShieldCheck className="size-3.5 text-success-text" /> I confirm we have consent or another lawful basis to call these contacts
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-foreground-muted">
              You’re responsible for complying with telemarketing rules where you call (for example TRAI in India, TCPA in the US, PECR in the UK). Leads who ask not to be called are suppressed automatically.
            </span>
          </span>
        </label>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={save.isPending || (state.callingEnabled && !state.attestConsent)} onClick={() => save.mutate()}>
            Save settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
