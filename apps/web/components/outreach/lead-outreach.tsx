"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, FlaskConical, Mail, MessageCircle, MessagesSquare, PhoneCall, RefreshCw, Send, Sparkles } from "lucide-react";
import type { Channel } from "@repo/config";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  Label,
  SegmentedControl,
  Skeleton,
  Textarea,
  Tooltip,
  cn,
  toast,
} from "@repo/ui";
import { apiWithMeta, api, errorMessage } from "@/lib/api-client";
import { useCanWrite } from "../shell/shell-context";
import { RelativeTime } from "../time";
import { ChannelIcon, IntentBadge, ProviderPill, type ProviderState } from "./shared";
import { ConversationThread } from "./thread";

interface PitchPack {
  email: { subject: string; body: string };
  whatsapp: string;
  callOpening: string;
  callPitch: string;
  followUp: string;
  meetingRequest: string;
  objections: Array<{ objection: string; response: string }>;
  personalization: string[];
}

interface PitchResult {
  pack: PitchPack;
  meta: { provider: string; model: string; cached: boolean; credits: number; simulated: boolean };
}

interface LeadConversation {
  id: string;
  channel: Channel;
  status: string;
  subject: string | null;
  lastMessageAt: string;
  unreadCount: number;
  aiIntent: Parameters<typeof IntentBadge>[0]["intent"] | null;
  campaign: { id: string; name: string } | null;
  lastMessage: { direction: "OUTBOUND" | "INBOUND"; body: string } | null;
}

function CopyButton({ text }: { text: string }) {
  return (
    <Tooltip content="Copy">
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Copy"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => toast.success("Copied"));
        }}
      >
        <Copy />
      </Button>
    </Tooltip>
  );
}

function Asset({ title, icon: Icon, text, action }: { title: string; icon: typeof Mail; text: string; action?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface shadow-xs">
      <header className="flex items-center gap-2 border-b border-border px-3.5 py-2">
        <Icon className="size-3.5 text-foreground-muted" />
        <h4 className="text-xs font-semibold">{title}</h4>
        <div className="ml-auto flex items-center gap-1">
          {action}
          <CopyButton text={text} />
        </div>
      </header>
      <p className="px-3.5 py-3 text-[13px] leading-relaxed whitespace-pre-wrap text-foreground-secondary">{text}</p>
    </section>
  );
}

// ----------------------------------------------------------------------------- Compose

export function ComposeDialog({
  leadId,
  leadName,
  providers,
  open,
  onOpenChange,
  initial,
}: {
  leadId: string;
  leadName: string;
  providers: { EMAIL: ProviderState; WHATSAPP: ProviderState };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: { channel: "EMAIL" | "WHATSAPP"; subject: string; body: string };
}) {
  const queryClient = useQueryClient();
  const [channel, setChannel] = React.useState(initial.channel);
  const [subject, setSubject] = React.useState(initial.subject);
  const [body, setBody] = React.useState(initial.body);
  const send = useMutation({
    mutationFn: (sendNow: boolean) => api(`/api/v1/leads/${leadId}/messages`, { method: "POST", json: { channel, subject: channel === "EMAIL" ? subject : undefined, body, sendNow } }),
    onSuccess: (_, sendNow) => {
      toast.success(sendNow ? (providers[channel].simulated ? "Queued via the demo provider — not delivered" : "Message queued") : "Saved as draft");
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ["lead-conversations", leadId] });
      void queryClient.invalidateQueries({ queryKey: ["lead-timeline", leadId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const provider = providers[channel];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Message {leadName}</DialogTitle>
          <DialogDescription>Sent outside any campaign. Opt-outs, suppression and WhatsApp rules still apply.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <SegmentedControl
              size="sm"
              value={channel}
              onValueChange={setChannel}
              options={[
                { value: "EMAIL", label: "Email" },
                { value: "WHATSAPP", label: "WhatsApp" },
              ]}
            />
            <ProviderPill state={provider} />
          </div>
          {channel === "EMAIL" ? (
            <Field>
              <Label htmlFor="compose-subject">Subject</Label>
              <Input id="compose-subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
            </Field>
          ) : (
            <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-foreground-muted">
              Free-form WhatsApp messages only work within 24 hours of the lead’s last message. To start a conversation, use a campaign step with an approved template.
            </p>
          )}
          <Field>
            <Label htmlFor="compose-body">Message</Label>
            <Textarea id="compose-body" rows={9} value={body} onChange={(event) => setBody(event.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => send.mutate(false)} disabled={!body.trim() || send.isPending}>
            Save draft
          </Button>
          <Button variant="primary" size="sm" onClick={() => send.mutate(true)} disabled={!body.trim() || (channel === "EMAIL" && !subject.trim()) || !provider.ok || send.isPending}>
            <Send /> Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------- Tab

export function LeadOutreachPanel({ lead, providers }: { lead: { id: string; name: string; doNotContact: boolean }; providers: { EMAIL: ProviderState; WHATSAPP: ProviderState } }) {
  const canWrite = useCanWrite();
  const [compose, setCompose] = React.useState<{ key: number; open: boolean; value: { channel: "EMAIL" | "WHATSAPP"; subject: string; body: string } }>({
    key: 0,
    open: false,
    value: { channel: "EMAIL", subject: "", body: "" },
  });
  const [openConversation, setOpenConversation] = React.useState<string | null>(null);

  const conversations = useQuery({
    queryKey: ["lead-conversations", lead.id],
    queryFn: () => apiWithMeta<LeadConversation[]>(`/api/v1/conversations?leadId=${lead.id}&limit=20`),
    refetchInterval: 20_000,
  });
  const pitch = useMutation({
    mutationFn: () => api<PitchResult>(`/api/v1/leads/${lead.id}/pitch`, { method: "POST", json: {} }),
    onError: (error) => toast.error(errorMessage(error)),
  });
  // A new key remounts the dialog so it starts from the handed-in content.
  const openCompose = (value: { channel: "EMAIL" | "WHATSAPP"; subject: string; body: string }) => setCompose((current) => ({ key: current.key + 1, open: true, value }));
  const pack = pitch.data?.pack;
  const items = conversations.data?.data ?? [];

  return (
    <div className="grid gap-5">
      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-[13px] font-semibold">Conversations</h3>
            <p className="text-xs text-foreground-muted">Every email and WhatsApp thread with {lead.name}</p>
          </div>
          {canWrite && !lead.doNotContact ? (
            <Button size="sm" variant="secondary" onClick={() => openCompose({ channel: "EMAIL", subject: `Quick question for ${lead.name}`, body: "" })}>
              <Mail /> New message
            </Button>
          ) : null}
        </div>
        {conversations.isPending ? (
          <Skeleton className="h-24" />
        ) : items.length ? (
          <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
            {items.map((conversation) => (
              <div key={conversation.id} className="border-b border-border last:border-0">
                <button
                  type="button"
                  onClick={() => setOpenConversation(openConversation === conversation.id ? null : conversation.id)}
                  className={cn("flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-muted/50", openConversation === conversation.id && "bg-surface-muted/60")}
                  aria-expanded={openConversation === conversation.id}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-foreground-secondary">
                    <ChannelIcon channel={conversation.channel} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium">{conversation.subject ?? (conversation.channel === "WHATSAPP" ? "WhatsApp" : "Email thread")}</span>
                      {conversation.aiIntent ? <IntentBadge intent={conversation.aiIntent} /> : null}
                    </span>
                    <span className="block truncate text-xs text-foreground-muted">
                      {conversation.lastMessage ? `${conversation.lastMessage.direction === "OUTBOUND" ? "You: " : ""}${conversation.lastMessage.body.replace(/\s+/g, " ")}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[11px] text-foreground-muted">
                    <RelativeTime value={conversation.lastMessageAt} />
                    {conversation.campaign ? <span className="block max-w-36 truncate">{conversation.campaign.name}</span> : null}
                  </span>
                </button>
                {openConversation === conversation.id ? (
                  <div className="h-[520px] border-t border-border bg-background">
                    <ConversationThread conversationId={conversation.id} compact />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-surface">
            <EmptyState compact icon={MessagesSquare} title="No conversations yet" description="Add the lead to a campaign or send a one-off message." />
          </div>
        )}
      </section>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
              <Sparkles className="size-3.5 text-accent" /> Pitch pack
            </h3>
            <p className="text-xs text-foreground-muted">Email, WhatsApp, call script and objection handling written for this lead from its real data.</p>
          </div>
          {canWrite ? (
            <Button size="sm" variant={pack ? "secondary" : "primary"} onClick={() => pitch.mutate()} disabled={pitch.isPending}>
              {pitch.isPending ? <RefreshCw className="animate-spin" /> : <Sparkles />} {pack ? "Regenerate" : "Generate pitch pack"}
            </Button>
          ) : null}
        </div>
        {pitch.isPending && !pack ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        ) : pack ? (
          <div className={cn("grid gap-3 transition-opacity", pitch.isPending && "opacity-60")}>
            {pitch.data?.meta.simulated ? (
              <p className="inline-flex items-center gap-1.5 text-xs text-warning-text">
                <FlaskConical className="size-3" /> Written by the demo AI provider (deterministic templates from lead data). Connect an AI provider for model-written copy.
              </p>
            ) : (
              <p className="text-xs text-foreground-muted">
                {pitch.data?.meta.model} · {pitch.data?.meta.cached ? "cached" : `${pitch.data?.meta.credits} credits`}
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <Asset
                title={`Email · ${pack.email.subject}`}
                icon={Mail}
                text={pack.email.body}
                action={
                  canWrite && !lead.doNotContact ? (
                    <Button size="xs" variant="ghost" onClick={() => openCompose({ channel: "EMAIL", subject: pack.email.subject, body: pack.email.body })}>
                      Use
                    </Button>
                  ) : null
                }
              />
              <Asset title="WhatsApp" icon={MessageCircle} text={pack.whatsapp} />
              <Asset title="Call opening" icon={PhoneCall} text={pack.callOpening} />
              <Asset title="Call pitch" icon={PhoneCall} text={pack.callPitch} />
              <Asset title="Follow-up" icon={Mail} text={pack.followUp} />
              <Asset title="Meeting request" icon={Mail} text={pack.meetingRequest} />
            </div>
            <section className="rounded-lg border border-border bg-surface shadow-xs">
              <header className="border-b border-border px-3.5 py-2">
                <h4 className="text-xs font-semibold">Objection handling</h4>
              </header>
              <dl className="divide-y divide-border">
                {pack.objections.map((item) => (
                  <div key={item.objection} className="grid gap-1 px-3.5 py-2.5 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
                    <dt className="text-[13px] font-medium">“{item.objection}”</dt>
                    <dd className="text-[13px] leading-relaxed text-foreground-secondary">{item.response}</dd>
                  </div>
                ))}
              </dl>
            </section>
            {pack.personalization.length ? (
              <p className="text-xs text-foreground-muted">Personalised using: {pack.personalization.join(" · ")}</p>
            ) : null}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-center text-[13px] text-foreground-muted">
            Prices are only mentioned if they’re configured in your offerings — the AI never invents them.
          </div>
        )}
      </section>

      <ComposeDialog
        key={compose.key}
        leadId={lead.id}
        leadName={lead.name}
        providers={providers}
        open={compose.open}
        onOpenChange={(open) => setCompose((current) => ({ ...current, open }))}
        initial={compose.value}
      />
    </div>
  );
}
