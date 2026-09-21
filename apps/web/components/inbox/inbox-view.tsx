"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, CheckCheck, Inbox, Mail, MessageCircle, MessagesSquare } from "lucide-react";
import { LEAD_STATUS_LABELS, type Channel, type LeadStatus, type ReplyIntent } from "@repo/config";
import { Button, CompanyMark, DescriptionList, EmptyState, ErrorState, ScoreIndicator, SearchInput, SegmentedControl, Skeleton, cn } from "@repo/ui";
import { apiWithMeta, api, errorMessage } from "@/lib/api-client";
import { RelativeTime } from "../time";
import { ReviewQueue } from "../outreach/review-queue";
import { ChannelIcon, IntentBadge } from "../outreach/shared";
import { ConversationThread, type ConversationDetail } from "../outreach/thread";

interface ConversationListItem {
  id: string;
  channel: Channel;
  status: "OPEN" | "AWAITING_REPLY" | "NEEDS_RESPONSE" | "CLOSED";
  subject: string | null;
  unreadCount: number;
  aiIntent: ReplyIntent | null;
  lastMessageAt: string;
  lead: { id: string; name: string; city: string | null; locality: string | null; score: number | null };
  campaign: { id: string; name: string } | null;
  lastMessage: { direction: "OUTBOUND" | "INBOUND"; body: string; subject: string | null; status: string } | null;
}

type StatusFilter = "NEEDS_RESPONSE" | "AWAITING_REPLY" | "all" | "CLOSED";

const STATUS_TABS: Array<{ value: StatusFilter; label: string }> = [
  { value: "NEEDS_RESPONSE", label: "Needs response" },
  { value: "AWAITING_REPLY", label: "Waiting" },
  { value: "all", label: "All" },
  { value: "CLOSED", label: "Closed" },
];

function useUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  return { params, set };
}

function ConversationRow({ item, active, onSelect }: { item: ConversationListItem; active: boolean; onSelect: () => void }) {
  const unread = item.unreadCount > 0;
  const preview = item.lastMessage ? `${item.lastMessage.direction === "OUTBOUND" ? "You: " : ""}${item.lastMessage.body.replace(/\s+/g, " ")}` : "";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={cn(
        "relative flex w-full gap-3 border-b border-border px-4 py-3 text-left transition-colors",
        active ? "bg-surface-muted" : "hover:bg-surface-muted/50",
      )}
    >
      {unread ? <span aria-label="Unread" className="absolute top-1/2 left-1.5 size-1.5 -translate-y-1/2 rounded-full bg-accent" /> : null}
      <CompanyMark name={item.lead.name} className="size-8 text-[11px]" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cn("truncate text-[13px]", unread ? "font-semibold text-foreground" : "font-medium text-foreground")}>{item.lead.name}</span>
          <ChannelIcon channel={item.channel} className="size-3 shrink-0 text-foreground-subtle" />
          <RelativeTime value={item.lastMessageAt} className="ml-auto shrink-0 text-[11px] text-foreground-muted" />
        </span>
        {item.channel === "EMAIL" && item.subject ? <span className="block truncate text-xs text-foreground-secondary">{item.subject}</span> : null}
        <span className={cn("mt-0.5 line-clamp-2 text-xs leading-relaxed", unread ? "text-foreground-secondary" : "text-foreground-muted")}>{preview}</span>
        {item.aiIntent || item.campaign ? (
          <span className="mt-1.5 flex items-center gap-1.5">
            {item.aiIntent ? <IntentBadge intent={item.aiIntent} /> : null}
            {item.campaign ? <span className="truncate text-[11px] text-foreground-subtle">{item.campaign.name}</span> : null}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function LeadContext({ conversationId }: { conversationId: string }) {
  const query = useQuery({ queryKey: ["conversation", conversationId], queryFn: () => api<ConversationDetail>(`/api/v1/conversations/${conversationId}`) });
  const conversation = query.data;
  if (!conversation) return <Skeleton className="m-4 h-64" />;
  const { lead } = conversation;
  const contact = lead.contacts.find((item) => item.isPrimary) ?? lead.contacts[0];
  return (
    <div className="grid content-start gap-4 p-4">
      <div className="flex items-center gap-3">
        <ScoreIndicator score={lead.score} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{lead.name}</p>
          <p className="text-xs text-foreground-muted">{LEAD_STATUS_LABELS[lead.status as LeadStatus] ?? lead.status}</p>
        </div>
      </div>
      <DescriptionList
        items={[
          { label: "Contact", value: contact ? [contact.name, contact.title].filter(Boolean).join(", ") || null : null },
          { label: "Email", value: contact?.email ?? lead.email },
          { label: "Phone", value: contact?.phone ?? lead.phone },
          { label: "WhatsApp opt-in", value: contact ? (contact.whatsappOptIn ? "Yes" : "No") : null },
          { label: "Location", value: [lead.locality, lead.city].filter(Boolean).join(", ") || null },
          {
            label: "Campaign",
            value: conversation.campaign ? (
              <Link href={`/app/campaigns/${conversation.campaign.id}`} className="hover:underline">
                {conversation.campaign.name}
              </Link>
            ) : null,
          },
        ]}
      />
      <Button asChild size="sm" variant="secondary">
        <Link href={`/app/leads/${lead.id}`}>
          Open lead workspace <ArrowUpRight />
        </Link>
      </Button>
    </div>
  );
}

export function InboxView({ counts }: { counts: { needsResponse: number; pendingApproval: number } }) {
  const { params, set } = useUrlState();
  const view = params.get("view") === "review" ? "review" : "inbox";
  const channel = (params.get("channel") as "EMAIL" | "WHATSAPP" | null) ?? null;
  const status = (params.get("status") as StatusFilter | null) ?? (counts.needsResponse ? "NEEDS_RESPONSE" : "all");
  const selected = params.get("c");
  // SearchInput debounces before calling onChange.
  const [search, setSearch] = React.useState(params.get("q") ?? "");

  const listParams = new URLSearchParams({ limit: "40" });
  if (channel) listParams.set("channel", channel);
  if (status !== "all") listParams.set("status", status);
  if (search) listParams.set("q", search);

  const list = useInfiniteQuery({
    queryKey: ["conversations", channel, status, search],
    queryFn: ({ pageParam }) => apiWithMeta<ConversationListItem[], { nextCursor: string | null; counts: Record<string, number> }>(`/api/v1/conversations?${listParams.toString()}${pageParam ? `&cursor=${pageParam}` : ""}`),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.meta.nextCursor,
    refetchInterval: 15_000,
    placeholderData: (previous) => previous,
  });
  const items = list.data?.pages.flatMap((page) => page.data) ?? [];
  const tabCounts = list.data?.pages[0]?.meta.counts ?? {};

  return (
    <div className="flex h-[calc(100dvh-2.75rem)] min-h-[520px]">
      {/* List */}
      <section className={cn("flex w-full min-w-0 flex-col border-r border-border bg-surface md:w-[360px] md:shrink-0", selected && view === "inbox" ? "hidden md:flex" : "flex")}>
        <div className="grid gap-3 border-b border-border px-4 pt-4 pb-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-base font-semibold tracking-[-0.01em]">Inbox</h1>
            <SegmentedControl
              size="sm"
              value={view}
              onValueChange={(value) => set({ view: value === "review" ? "review" : null, c: null })}
              options={[
                { value: "inbox", label: "Conversations" },
                {
                  value: "review",
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      Review
                      {counts.pendingApproval ? <span className="rounded-full bg-warning-soft px-1.5 text-[10px] font-semibold text-warning-text tabular">{counts.pendingApproval}</span> : null}
                    </span>
                  ),
                },
              ]}
            />
          </div>
          {view === "inbox" ? (
            <>
              <SearchInput value={search} onChange={setSearch} placeholder="Search people and messages" />
              <div className="flex items-center gap-1">
                {[
                  { value: null, label: "All", icon: MessagesSquare },
                  { value: "EMAIL", label: "Email", icon: Mail },
                  { value: "WHATSAPP", label: "WhatsApp", icon: MessageCircle },
                ].map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => set({ channel: option.value, c: null })}
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
                      channel === option.value ? "bg-surface-muted text-foreground" : "text-foreground-muted hover:text-foreground",
                    )}
                  >
                    <option.icon className="size-3.5" /> {option.label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs leading-relaxed text-foreground-muted">Messages prepared by campaigns that wait for a human decision. Edit, approve or skip — nothing is sent without you.</p>
          )}
        </div>

        {view === "inbox" ? (
          <>
            <div className="flex gap-4 overflow-x-auto border-b border-border px-4 text-xs" role="tablist" aria-label="Conversation status">
              {STATUS_TABS.map((tab) => {
                const count = tab.value === "all" ? null : (tabCounts[tab.value] ?? 0);
                return (
                  <button
                    key={tab.value}
                    type="button"
                    role="tab"
                    aria-selected={status === tab.value}
                    onClick={() => set({ status: tab.value, c: null })}
                    className={cn(
                      "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 py-2.5 font-medium transition-colors",
                      status === tab.value ? "border-foreground text-foreground" : "border-transparent text-foreground-muted hover:text-foreground",
                    )}
                  >
                    {tab.label}
                    {count ? <span className="text-foreground-subtle tabular">{count}</span> : null}
                  </button>
                );
              })}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {list.isPending ? (
                <div className="grid gap-px">
                  {Array.from({ length: 7 }, (_, index) => (
                    <div key={index} className="flex gap-3 border-b border-border px-4 py-3">
                      <Skeleton className="size-8 rounded-md" />
                      <div className="grid flex-1 gap-1.5">
                        <Skeleton className="h-3.5 w-2/3" />
                        <Skeleton className="h-3 w-full" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : list.isError ? (
                <ErrorState description={errorMessage(list.error)} onRetry={() => void list.refetch()} />
              ) : items.length === 0 ? (
                <EmptyState
                  compact
                  icon={status === "NEEDS_RESPONSE" ? CheckCheck : Inbox}
                  title={status === "NEEDS_RESPONSE" ? "You’re all caught up" : "No conversations"}
                  description={status === "NEEDS_RESPONSE" ? "Replies that need you will land here, classified by AI." : "Conversations start when campaigns send their first messages."}
                />
              ) : (
                <>
                  {items.map((item) => (
                    <ConversationRow key={item.id} item={item} active={item.id === selected} onSelect={() => set({ c: item.id })} />
                  ))}
                  {list.hasNextPage ? (
                    <div className="p-3">
                      <Button size="sm" variant="ghost" className="w-full" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                        {list.isFetchingNextPage ? "Loading…" : "Load more"}
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </>
        ) : null}
      </section>

      {/* Thread / review */}
      <section className={cn("min-w-0 flex-1 flex-col bg-background", selected || view === "review" ? "flex" : "hidden md:flex")}>
        {view === "review" ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            <div className="mx-auto max-w-3xl">
              <ReviewQueue
                emptyAction={
                  <Button asChild size="sm" variant="secondary">
                    <Link href="/app/campaigns">View campaigns</Link>
                  </Button>
                }
              />
            </div>
          </div>
        ) : selected ? (
          <ConversationThread key={selected} conversationId={selected} onClose={() => set({ c: null })} />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState icon={MessagesSquare} title="Select a conversation" description="Email and WhatsApp threads with every lead, with AI-classified replies and suggested responses." />
          </div>
        )}
      </section>

      {/* Lead context */}
      {view === "inbox" && selected ? (
        <aside className="hidden w-[280px] shrink-0 border-l border-border bg-surface 2xl:block">
          <LeadContext conversationId={selected} />
        </aside>
      ) : null}
    </div>
  );
}
