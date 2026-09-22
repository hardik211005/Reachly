"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Clock, Mail, PhoneCall, Search, ShieldCheck, Trash2 } from "lucide-react";
import { Badge, Button, Callout, EmptyState, ErrorState, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, Spinner, Switch, Textarea, cn, toast } from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { TagInput } from "../forms/tag-input";
import { useCanManage } from "../shell/shell-context";
import { ReadOnlyNotice, Row, SaveBar, Section } from "./kit";

interface Settings {
  postalAddress: string | null;
  emailFooter: string | null;
  includeUnsubscribeLink: boolean;
  requireApprovalFirstTouch: boolean;
  whatsappRequireOptIn: boolean;
  quietHours: { start: number; end: number; days: number[] };
  optOutKeywords: string[];
  calling: { callingEnabled: boolean; callingConsentAttested: boolean; callingConsentAttestedAt: string | null; recordCalls: boolean; announceAiOnCalls: boolean; dndCheckEnabled: boolean };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hour = (value: number) => (value === 24 ? "Midnight" : new Date(2000, 0, 1, value).toLocaleTimeString(undefined, { hour: "numeric" }));

function OutreachRules({ settings }: { settings: Settings }) {
  const queryClient = useQueryClient();
  const canManage = useCanManage();
  const initial = {
    postalAddress: settings.postalAddress ?? "",
    emailFooter: settings.emailFooter ?? "",
    requireApprovalFirstTouch: settings.requireApprovalFirstTouch,
    whatsappRequireOptIn: settings.whatsappRequireOptIn,
    quietHours: settings.quietHours,
    optOutKeywords: settings.optOutKeywords,
  };
  const [form, setForm] = React.useState(initial);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  const save = useMutation({
    mutationFn: () => api<Settings>("/api/v1/compliance", { method: "PUT", json: { ...form, postalAddress: form.postalAddress || null, emailFooter: form.emailFooter || null } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["compliance"], updated);
      toast.success("Outreach rules saved");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const invalidWindow = form.quietHours.end <= form.quietHours.start || form.quietHours.days.length === 0;
  const disabled = !canManage;
  return (
    <Section title="Sending rules" description="Applied to every campaign, on every channel." icon={Clock} footer={canManage ? <SaveBar dirty={dirty} pending={save.isPending} onSave={() => save.mutate()} onReset={() => setForm(initial)} disabled={invalidWindow || form.optOutKeywords.length === 0} /> : null}>
      {canManage ? null : <ReadOnlyNotice what="compliance settings" />}
      <Row label="Sending window" hint="Messages and calls only go out in these hours, in your workspace's time zone.">
        <div className="grid gap-3">
          <div className="flex items-center gap-2">
            <Select value={String(form.quietHours.start)} onValueChange={(value) => set("quietHours", { ...form.quietHours, start: Number(value) })} disabled={disabled}>
              <SelectTrigger className="w-32" aria-label="Start hour">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, value) => (
                  <SelectItem key={value} value={String(value)}>
                    {hour(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[13px] text-foreground-muted">to</span>
            <Select value={String(form.quietHours.end)} onValueChange={(value) => set("quietHours", { ...form.quietHours, end: Number(value) })} disabled={disabled}>
              <SelectTrigger className="w-32" aria-label="End hour">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, index) => index + 1).map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {hour(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sending days">
            {DAYS.map((day, index) => {
              const on = form.quietHours.days.includes(index);
              return (
                <button key={day} type="button" aria-pressed={on} disabled={disabled} onClick={() => set("quietHours", { ...form.quietHours, days: on ? form.quietHours.days.filter((item) => item !== index) : [...form.quietHours.days, index].sort() })} className={cn("h-8 w-11 rounded-md border text-[12px] font-medium transition-colors", on ? "border-transparent bg-foreground text-background" : "border-border text-foreground-muted hover:text-foreground")}>
                  {day}
                </button>
              );
            })}
          </div>
          {invalidWindow ? <p className="text-[12px] text-danger-text">Pick at least one day, and an end time after the start.</p> : null}
        </div>
      </Row>
      <Row label="Approve first messages" hint="The first message to any lead waits for a person, even in automated campaigns.">
        <Switch checked={form.requireApprovalFirstTouch} onCheckedChange={(value) => set("requireApprovalFirstTouch", value)} disabled={disabled} aria-label="Approve first messages" />
      </Row>
      <Row label="WhatsApp opt-in" hint="Only message WhatsApp contacts with a recorded opt-in, as WhatsApp's business policy requires.">
        <Switch checked={form.whatsappRequireOptIn} onCheckedChange={(value) => set("whatsappRequireOptIn", value)} disabled={disabled} aria-label="Require WhatsApp opt-in" />
      </Row>
      <Row label="Unsubscribe link" hint="Always added to email, with one-click unsubscribe headers.">
        <Badge tone="success">Always on</Badge>
      </Row>
      <Row label="Postal address" hint="Added to the footer of commercial email where the law requires it." htmlFor="compliance-address">
        <Textarea id="compliance-address" rows={2} value={form.postalAddress} disabled={disabled} onChange={(event) => set("postalAddress", event.target.value)} placeholder="Company name, street, city, postcode" />
      </Row>
      <Row label="Email footer" hint="Optional text after every email." htmlFor="compliance-footer">
        <Textarea id="compliance-footer" rows={2} value={form.emailFooter} disabled={disabled} onChange={(event) => set("emailFooter", event.target.value)} />
      </Row>
      <Row label="Opt-out phrases" hint="Replies or call answers containing these stop all outreach to that contact.">
        <TagInput value={form.optOutKeywords} onChange={(value) => set("optOutKeywords", value)} placeholder="Add a phrase" max={40} />
      </Row>
    </Section>
  );
}

function CallingRules({ settings }: { settings: Settings }) {
  const queryClient = useQueryClient();
  const canManage = useCanManage();
  const initial = { callingEnabled: settings.calling.callingEnabled, attestConsent: settings.calling.callingConsentAttested, recordCalls: settings.calling.recordCalls, announceAiOnCalls: settings.calling.announceAiOnCalls, dndCheckEnabled: settings.calling.dndCheckEnabled };
  const [form, setForm] = React.useState(initial);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = <K extends keyof typeof form>(key: K, value: boolean) => setForm((current) => ({ ...current, [key]: value, ...(key === "attestConsent" && !value ? { callingEnabled: false } : {}) }));
  const save = useMutation({
    mutationFn: () => api("/api/v1/compliance/calling", { method: "PUT", json: form }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["compliance"] });
      toast.success("Calling rules saved");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const disabled = !canManage;
  return (
    <Section title="AI calling" description="Rules for calls the AI voice agent places." icon={PhoneCall} footer={canManage ? <SaveBar dirty={dirty} pending={save.isPending} onSave={() => save.mutate()} onReset={() => setForm(initial)} /> : null}>
      <Row label="Consent" hint={settings.calling.callingConsentAttestedAt ? `Confirmed on ${new Date(settings.calling.callingConsentAttestedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}.` : "Required before AI calling can be turned on."}>
        <label className="flex items-start gap-3 text-[13px] text-foreground-secondary">
          <Switch checked={form.attestConsent} onCheckedChange={(value) => set("attestConsent", value)} disabled={disabled} aria-label="Confirm consent" />
          <span>We have consent or another lawful basis to call the contacts we call.</span>
        </label>
      </Row>
      <Row label="AI calling" hint="Turns the voice agent on for this workspace.">
        <Switch checked={form.callingEnabled} onCheckedChange={(value) => set("callingEnabled", value)} disabled={disabled || !form.attestConsent} aria-label="Enable AI calling" />
      </Row>
      <Row label="Announce the AI" hint="The agent says it's an AI assistant at the start of each call.">
        <Switch checked={form.announceAiOnCalls} onCheckedChange={(value) => set("announceAiOnCalls", value)} disabled={disabled} aria-label="Announce the AI" />
      </Row>
      <Row label="Check DND registry" hint="Skip numbers on do-not-disturb lists where the provider supports it.">
        <Switch checked={form.dndCheckEnabled} onCheckedChange={(value) => set("dndCheckEnabled", value)} disabled={disabled} aria-label="Check DND" />
      </Row>
      <Row label="Record calls" hint="Keep audio recordings. Some regions require telling the other person.">
        <Switch checked={form.recordCalls} onCheckedChange={(value) => set("recordCalls", value)} disabled={disabled} aria-label="Record calls" />
      </Row>
    </Section>
  );
}

interface Suppression {
  id: string;
  type: "EMAIL" | "PHONE" | "DOMAIN" | "LEAD";
  value: string;
  reason: string;
  channel: string | null;
  note: string | null;
  createdAt: string;
}

const REASON_LABEL: Record<string, string> = { OPT_OUT: "Opted out", UNSUBSCRIBE: "Unsubscribed", BOUNCE: "Bounced", COMPLAINT: "Complaint", MANUAL: "Added by hand", DND: "DND", WRONG_CONTACT: "Wrong contact" };

function Suppressions() {
  const queryClient = useQueryClient();
  const canManage = useCanManage();
  const [q, setQ] = React.useState("");
  const [value, setValue] = React.useState("");
  const list = useQuery({ queryKey: ["suppressions", q], queryFn: () => api<{ items: Suppression[]; total: number }>(`/api/v1/compliance/suppressions${q ? `?q=${encodeURIComponent(q)}` : ""}`), placeholderData: (previous) => previous });
  const add = useMutation({
    mutationFn: () => api("/api/v1/compliance/suppressions", { method: "POST", json: { value } }),
    onSuccess: () => {
      toast.success(`${value} won't be contacted`);
      setValue("");
      void queryClient.invalidateQueries({ queryKey: ["suppressions"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/v1/compliance/suppressions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Removed from the block list");
      void queryClient.invalidateQueries({ queryKey: ["suppressions"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Section title={`Block list${list.data ? ` · ${list.data.total.toLocaleString()}` : ""}`} description="Addresses, numbers and domains that are never contacted. Opt-outs, unsubscribes and bounces land here automatically." icon={Ban}>
      <div className="grid gap-3">
        {canManage ? (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (value.trim()) add.mutate();
            }}
          >
            <Input aria-label="Email, phone or domain to block" placeholder="name@company.com, +91 98…, or company.com" value={value} onChange={(event) => setValue(event.target.value)} />
            <Button type="submit" variant="secondary" disabled={!value.trim() || add.isPending}>
              {add.isPending ? <Spinner className="size-3.5" /> : <Ban />} Block
            </Button>
          </form>
        ) : null}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-muted" />
          <Input aria-label="Search the block list" placeholder="Search" value={q} onChange={(event) => setQ(event.target.value)} className="pl-9" />
        </div>
        {list.isError ? (
          <ErrorState description={errorMessage(list.error)} onRetry={() => void list.refetch()} />
        ) : !list.data ? (
          <Skeleton className="h-32" />
        ) : list.data.items.length === 0 ? (
          <EmptyState compact icon={ShieldCheck} title={q ? "No matches" : "Nobody is blocked yet"} description={q ? "Try a different search." : "Opt-outs and bounces will appear here."} />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-surface-muted/60 text-[11px] text-foreground-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Contact</th>
                  <th className="hidden px-3 py-2 font-medium sm:table-cell">Reason</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">Added</th>
                  <th className="w-12 px-3 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.data.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2">
                        {item.type === "EMAIL" ? <Mail className="size-3.5 text-foreground-muted" /> : item.type === "PHONE" ? <PhoneCall className="size-3.5 text-foreground-muted" /> : <Ban className="size-3.5 text-foreground-muted" />}
                        <span className="truncate font-medium">{item.value}</span>
                      </span>
                    </td>
                    <td className="hidden px-3 py-2.5 sm:table-cell">
                      <Badge tone={item.reason === "MANUAL" ? "neutral" : "warning"}>{REASON_LABEL[item.reason] ?? item.reason}</Badge>
                      {item.channel ? <span className="ml-1.5 text-[11px] text-foreground-muted">{item.channel.toLowerCase()}</span> : null}
                    </td>
                    <td className="hidden px-3 py-2.5 text-[12px] text-foreground-muted md:table-cell">{new Date(item.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}</td>
                    <td className="px-3 py-2.5 text-right">
                      {canManage ? (
                        <Button variant="ghost" size="icon-xs" aria-label={`Unblock ${item.value}`} disabled={remove.isPending} onClick={() => remove.mutate(item.id)}>
                          <Trash2 />
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data && list.data.total > list.data.items.length ? <p className="text-[12px] text-foreground-muted">Showing the latest {list.data.items.length} of {list.data.total.toLocaleString()}. Search to find others.</p> : null}
      </div>
    </Section>
  );
}

export function ComplianceSettings() {
  const settings = useQuery({ queryKey: ["compliance"], queryFn: () => api<Settings>("/api/v1/compliance") });
  if (settings.isError) return <ErrorState description={errorMessage(settings.error)} onRetry={() => void settings.refetch()} />;
  if (!settings.data) return <Skeleton className="h-96 rounded-xl" />;
  return (
    <>
      <Callout tone="accent" icon={ShieldCheck} title="Guardrails are enforced by the engine">
        These rules are checked before every message and call. Changes apply to anything scheduled from now on.
      </Callout>
      <OutreachRules key={JSON.stringify(settings.data.quietHours) + settings.data.optOutKeywords.length} settings={settings.data} />
      <CallingRules key={String(settings.data.calling.callingConsentAttestedAt)} settings={settings.data} />
      <Suppressions />
    </>
  );
}
