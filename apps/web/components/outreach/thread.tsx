"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Ban, Clock, CornerDownLeft, Lock, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { REPLY_INTENT_LABELS, type Channel, type ReplyIntent } from "@repo/config";
import { Badge, Button, Callout, CompanyMark, ErrorState, Input, ScoreIndicator, Skeleton, Textarea, Tooltip, cn, toast } from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { useCanWrite } from "../shell/shell-context";
import { LocalTime, RelativeTime } from "../time";
import { ChannelIcon, IntentBadge, MessageStatusBadge, ProviderPill, SimulatedTag, type ProviderState } from "./shared";

// ----------------------------------------------------------------------------- Types (serialised rows)

export interface ThreadMessage {
  id: string;
  channel: Channel;
  direction: "OUTBOUND" | "INBOUND";
  status: string;
  subject: string | null;
  body: string;
  fromAddress: string | null;
  toAddress: string | null;
  generatedByAI: boolean;
  intent: ReplyIntent | null;
  sentiment: string | null;
  templateName: string | null;
  error: string | null;
  scheduledFor: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  readAt: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
  campaignStep: { name: string } | null;
}

export interface ConversationDetail {
  id: string;
  channel: Channel;
  status: "OPEN" | "AWAITING_REPLY" | "NEEDS_RESPONSE" | "CLOSED";
  subject: string | null;
  aiSummary: string | null;
  aiIntent: ReplyIntent | null;
  aiSentiment: string | null;
  suggestedReply: string | null;
  lastInboundAt: string | null;
  unreadCount: number;
  whatsappWindowOpen: boolean | null;
  provider: ProviderState | null;
  lead: {
    id: string;
    name: string;
    category: string | null;
    city: string | null;
    locality: string | null;
    score: number | null;
    status: string;
    website: string | null;
    email: string | null;
    phone: string | null;
    doNotContact: boolean;
    sourceProvider: string;
    contacts: Array<{ id: string; name: string | null; title: string | null; email: string | null; phone: string | null; whatsapp: string | null; whatsappOptIn: boolean; isPrimary: boolean }>;
  };
  campaign: { id: string; name: string; status: string; automationMode: string } | null;
  messages: ThreadMessage[];
}

// ----------------------------------------------------------------------------- Message bubble

/** Subject without "Re:" prefixes; a subject line is shown only when it changes. */
function baseSubject(message: ThreadMessage | undefined): string | null {
  return message?.subject?.replace(/^(re:\s*)+/i, "") ?? null;
}

function deliveryLine(message: ThreadMessage): React.ReactNode {
  if (message.direction === "INBOUND") return null;
  if (message.readAt) return <>Read <RelativeTime value={message.readAt} /></>;
  if (message.openedAt) return <>Opened <RelativeTime value={message.openedAt} /></>;
  if (message.deliveredAt) return <>Delivered <RelativeTime value={message.deliveredAt} /></>;
  if (message.sentAt) return <>Sent <RelativeTime value={message.sentAt} /></>;
  if (message.scheduledFor && ["APPROVED", "QUEUED"].includes(message.status)) return <>Scheduled for <LocalTime value={message.scheduledFor} /></>;
  return null;
}

export function MessageBubble({ message, showSubject }: { message: ThreadMessage; showSubject: boolean }) {
  const outbound = message.direction === "OUTBOUND";
  const simulated = Boolean(message.metadata?.simulated);
  const manual = Boolean(message.metadata?.manual);
  const muted = ["CANCELED", "SUPPRESSED", "FAILED", "BOUNCED"].includes(message.status);
  return (
    <div className={cn("flex w-full", outbound ? "justify-end" : "justify-start")}>
      <div className={cn("flex max-w-[min(560px,88%)] flex-col gap-1", outbound ? "items-end" : "items-start")}>
        <div
          className={cn(
            "rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed shadow-xs",
            outbound ? "rounded-br-sm border border-border bg-surface-raised" : "rounded-bl-sm bg-surface-sunken",
            muted && "opacity-60",
          )}
        >
          {showSubject && message.subject ? <p className="mb-1.5 font-semibold text-foreground">{message.subject}</p> : null}
          <p className="break-words whitespace-pre-wrap text-foreground-secondary">{message.body}</p>
          {message.templateName ? (
            <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-foreground-muted">
              <Lock className="size-3" /> Approved template · {message.templateName}
            </p>
          ) : null}
        </div>
        <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[11px] text-foreground-muted", outbound && "justify-end")}>
          {!outbound && message.intent ? <IntentBadge intent={message.intent} /> : null}
          {message.campaignStep ? <span>{message.campaignStep.name}</span> : manual && outbound ? <span>Manual</span> : null}
          {message.generatedByAI ? (
            <span className="inline-flex items-center gap-0.5">
              <Sparkles className="size-3" /> AI draft
            </span>
          ) : null}
          <LocalTime value={message.sentAt ?? message.createdAt} />
          {outbound ? <span className="text-foreground-subtle">{deliveryLine(message)}</span> : null}
          {outbound && !["SENT", "DELIVERED", "READ"].includes(message.status) ? <MessageStatusBadge status={message.status} error={message.error} /> : null}
          {simulated ? <SimulatedTag /> : null}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- AI analysis

function AnalysisCard({ conversation, onUseReply }: { conversation: ConversationDetail; onUseReply: (text: string) => void }) {
  if (!conversation.aiSummary && !conversation.aiIntent) return null;
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-foreground">
          <Sparkles className="size-3.5 text-accent" /> AI read of this conversation
        </span>
        {conversation.aiIntent ? <IntentBadge intent={conversation.aiIntent} /> : null}
        {conversation.aiSentiment ? <Badge tone="outline">{conversation.aiSentiment.toLowerCase()} sentiment</Badge> : null}
      </div>
      {conversation.aiSummary ? <p className="mt-2 text-[13px] leading-relaxed text-foreground-secondary">{conversation.aiSummary}</p> : null}
      {conversation.suggestedReply ? (
        <div className="mt-3 rounded-md border border-dashed border-border-strong bg-surface-muted/60 p-2.5">
          <p className="text-[11px] font-medium tracking-wide text-foreground-muted uppercase">Suggested reply</p>
          <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap text-foreground-secondary">{conversation.suggestedReply}</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => onUseReply(conversation.suggestedReply ?? "")}>
            <CornerDownLeft /> Use this reply
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------------------- Composer

function Composer({ conversation, draft, setDraft }: { conversation: ConversationDetail; draft: string; setDraft: (value: string) => void }) {
  const queryClient = useQueryClient();
  const [subject, setSubject] = React.useState("");
  const [editSubject, setEditSubject] = React.useState(false);
  const textarea = React.useRef<HTMLTextAreaElement>(null);
  const isEmail = conversation.channel === "EMAIL";
  const windowClosed = conversation.channel === "WHATSAPP" && !conversation.whatsappWindowOpen;
  const blocked = conversation.lead.doNotContact || !conversation.provider?.ok;

  const send = useMutation({
    mutationFn: () => api(`/api/v1/conversations/${conversation.id}/reply`, { method: "POST", json: { body: draft, ...(isEmail && subject.trim() ? { subject } : {}) } }),
    onSuccess: () => {
      setDraft("");
      setSubject("");
      setEditSubject(false);
      toast.success(conversation.provider?.simulated ? "Reply queued (demo provider — not delivered)" : "Reply queued");
      void queryClient.invalidateQueries({ queryKey: ["conversation", conversation.id] });
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  React.useEffect(() => {
    if (draft && textarea.current && document.activeElement !== textarea.current) textarea.current.focus();
  }, [draft]);

  if (conversation.lead.doNotContact) {
    return (
      <Callout tone="danger" icon={Ban}>
        This business is on your do-not-contact list. Replies are disabled.
      </Callout>
    );
  }
  if (windowClosed) {
    return (
      <Callout tone="warning" icon={Clock} title="WhatsApp 24-hour window closed">
        WhatsApp only allows free-form messages within 24 hours of the customer’s last message. Re-engage with an approved template from a campaign step.
      </Callout>
    );
  }

  const defaultSubject = conversation.subject ? `Re: ${conversation.subject.replace(/^(re:\s*)+/i, "")}` : "";
  return (
    <form
      className="rounded-lg border border-border bg-surface shadow-xs focus-within:border-border-strong"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.trim() && !send.isPending) send.mutate();
      }}
    >
      {isEmail ? (
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-foreground-muted">
          <span>Subject</span>
          {editSubject ? (
            <Input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder={defaultSubject} className="h-7 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0" autoFocus />
          ) : (
            <button type="button" className="truncate text-left text-foreground-secondary hover:text-foreground" onClick={() => setEditSubject(true)}>
              {subject || defaultSubject || "Add subject"}
            </button>
          )}
        </div>
      ) : null}
      <Textarea
        ref={textarea}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (draft.trim() && !send.isPending) send.mutate();
          }
        }}
        placeholder={isEmail ? "Write a reply…" : "Write a WhatsApp message…"}
        rows={4}
        className="min-h-24 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        aria-label="Reply"
      />
      <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
        <ProviderPill state={conversation.provider} />
        <div className="flex items-center gap-2">
          <span className="hidden text-[11px] text-foreground-subtle sm:inline">Ctrl + Enter to send</span>
          <Button type="submit" variant="primary" size="sm" disabled={!draft.trim() || send.isPending || blocked}>
            <Send /> {send.isPending ? "Sending…" : "Send"}
          </Button>
        </div>
      </div>
    </form>
  );
}

// ----------------------------------------------------------------------------- Thread

export function ConversationThread({ conversationId, onClose, compact = false }: { conversationId: string; onClose?: () => void; compact?: boolean }) {
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const [draft, setDraft] = React.useState("");
  const bottom = React.useRef<HTMLDivElement>(null);

  const query = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => api<ConversationDetail>(`/api/v1/conversations/${conversationId}`),
    refetchInterval: 15_000,
  });
  const conversation = query.data;

  const markRead = useMutation({
    mutationFn: () => api(`/api/v1/conversations/${conversationId}/read`, { method: "POST" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["conversations"] }),
  });
  const unread = conversation?.unreadCount ?? 0;
  const { mutate: markReadMutate } = markRead;
  React.useEffect(() => {
    if (unread > 0) markReadMutate();
  }, [conversationId, unread, markReadMutate]);

  const setStatus = useMutation({
    mutationFn: (status: "OPEN" | "CLOSED") => api(`/api/v1/conversations/${conversationId}`, { method: "PATCH", json: { status } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] });
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const messageCount = conversation?.messages.length ?? 0;
  React.useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messageCount, conversationId]);

  if (query.isPending) {
    return (
      <div className="grid gap-3 p-5">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="ml-auto h-24 w-2/3" />
        <Skeleton className="h-16 w-1/2" />
      </div>
    );
  }
  if (query.isError || !conversation) return <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />;

  const place = [conversation.lead.locality, conversation.lead.city].filter(Boolean).join(", ");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-5">
        <CompanyMark name={conversation.lead.name} className="size-8 text-xs" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link href={`/app/leads/${conversation.lead.id}`} className="truncate text-sm font-semibold hover:underline">
              {conversation.lead.name}
            </Link>
            <ScoreIndicator score={conversation.lead.score} size="sm" />
          </div>
          <p className="flex items-center gap-1.5 truncate text-xs text-foreground-muted">
            <ChannelIcon channel={conversation.channel} className="size-3" />
            {conversation.channel === "EMAIL" ? "Email" : "WhatsApp"}
            {place ? <span>· {place}</span> : null}
            {conversation.campaign ? (
              <>
                ·{" "}
                <Link href={`/app/campaigns/${conversation.campaign.id}`} className="truncate hover:text-foreground hover:underline">
                  {conversation.campaign.name}
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canWrite ? (
            conversation.status === "CLOSED" ? (
              <Button size="sm" variant="ghost" onClick={() => setStatus.mutate("OPEN")}>
                <RotateCcw /> Reopen
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setStatus.mutate("CLOSED")}>
                Close
              </Button>
            )
          ) : null}
          {compact ? null : (
            <Tooltip content="Open lead">
              <Button asChild size="icon" variant="ghost">
                <Link href={`/app/leads/${conversation.lead.id}`} aria-label="Open lead">
                  <ArrowUpRight />
                </Link>
              </Button>
            </Tooltip>
          )}
          {onClose ? (
            <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close thread" className="lg:hidden">
              <X />
            </Button>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        <div className="mx-auto grid max-w-3xl gap-4">
          <AnalysisCard conversation={conversation} onUseReply={setDraft} />
          {conversation.messages.map((message, index) => (
            <MessageBubble key={message.id} message={message} showSubject={conversation.channel === "EMAIL" && baseSubject(message) !== baseSubject(conversation.messages[index - 1])} />
          ))}
          {conversation.status === "CLOSED" ? <p className="text-center text-xs text-foreground-subtle">Conversation closed</p> : null}
          <div ref={bottom} />
        </div>
      </div>

      {canWrite ? (
        <div className="border-t border-border bg-background/60 px-4 py-3 sm:px-5">
          <div className="mx-auto max-w-3xl">
            <Composer conversation={conversation} draft={draft} setDraft={setDraft} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function intentLabel(intent: ReplyIntent | null): string | null {
  return intent ? REPLY_INTENT_LABELS[intent] : null;
}
