"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { Bell, CheckCheck } from "lucide-react";
import { Button, EmptyState, Popover, PopoverContent, PopoverTrigger, cn } from "@repo/ui";
import { api } from "@/lib/api-client";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export function NotificationsButton() {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ items: NotificationItem[]; unread: number }>("/api/v1/notifications"),
    refetchInterval: 60_000,
  });
  const markAll = useMutation({
    mutationFn: () => api("/api/v1/notifications/read", { method: "POST", json: {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unread = data?.unread ?? 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`} className="relative">
          <Bell />
          {unread > 0 ? <span className="absolute top-1 right-1 size-2 rounded-full bg-accent ring-2 ring-background" /> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-[13px] font-semibold">Notifications</p>
          {unread > 0 ? (
            <Button variant="ghost" size="xs" onClick={() => markAll.mutate()} loading={markAll.isPending}>
              <CheckCheck /> Mark all read
            </Button>
          ) : null}
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {!data || data.items.length === 0 ? (
            <EmptyState compact icon={Bell} title="You're all caught up" description="Replies, qualified leads and workflow alerts show up here." />
          ) : (
            <ul>
              {data.items.map((item) => {
                const content = (
                  <div className={cn("flex gap-2.5 px-3 py-2.5 transition-colors hover:bg-surface-muted", !item.readAt && "bg-accent-soft/40")}>
                    <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", item.readAt ? "bg-transparent" : "bg-accent")} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium">{item.title}</p>
                      {item.body ? <p className="mt-0.5 line-clamp-2 text-xs text-foreground-muted">{item.body}</p> : null}
                      <p className="mt-1 text-[11px] text-foreground-subtle">{formatDistanceToNowStrict(new Date(item.createdAt), { addSuffix: true })}</p>
                    </div>
                  </div>
                );
                return (
                  <li key={item.id} className="border-b border-border last:border-0">
                    {item.link ? (
                      <Link href={item.link} onClick={() => setOpen(false)}>
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
