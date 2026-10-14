"use client";

import * as React from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Bot, ChevronDown, KeyRound, ScrollText, ServerCog, User, Workflow } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, Spinner, cn } from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { useCanManage } from "../shell/shell-context";
import { Section } from "./kit";

interface AuditItem {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  actorType: "USER" | "SYSTEM" | "API_KEY" | "WORKFLOW" | "AI" | "PROVIDER";
  actor: string;
  ipAddress: string | null;
  createdAt: string;
}
interface AuditPage {
  items: AuditItem[];
  nextCursor: string | null;
  actions: Array<{ action: string; count: number }>;
}

const ACTOR_ICON = { USER: User, SYSTEM: ServerCog, API_KEY: KeyRound, WORKFLOW: Workflow, AI: Bot, PROVIDER: ServerCog } as const;
const AREA_TONE: Record<string, "accent" | "warning" | "danger" | "success" | "neutral"> = { billing: "success", workspace: "danger", member: "warning", members: "warning", invitation: "warning", compliance: "accent", integration: "accent", apikey: "danger", api_key: "danger" };

/** "scoring.model_trained" → "Scoring · model trained" */
function describe(action: string) {
  const [area = "", ...rest] = action.split(".");
  return { area, label: `${area.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}${rest.length ? ` · ${rest.join(" ").replace(/_/g, " ")}` : ""}` };
}

const when = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function Row({ item }: { item: AuditItem }) {
  const [open, setOpen] = React.useState(false);
  const { area, label } = describe(item.action);
  const Icon = ACTOR_ICON[item.actorType] ?? User;
  const hasDetails = Object.keys(item.metadata ?? {}).length > 0 || item.resourceId || item.ipAddress;
  return (
    <li className="border-b border-border last:border-0">
      <button type="button" disabled={!hasDetails} onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-3 px-1 py-3 text-left enabled:hover:bg-surface-muted/40" aria-expanded={open}>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-foreground-muted">
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium">{label}</span>
            <Badge tone={AREA_TONE[area] ?? "neutral"}>{item.resourceType.replace(/_/g, " ")}</Badge>
          </span>
          <span className="mt-0.5 block text-[12px] text-foreground-muted">
            {item.actor} · {when(item.createdAt)}
          </span>
        </span>
        {hasDetails ? <ChevronDown className={cn("size-4 shrink-0 text-foreground-subtle transition-transform", open && "rotate-180")} /> : null}
      </button>
      {open ? (
        <div className="mb-3 ml-10 grid gap-1.5 rounded-lg bg-surface-muted/50 px-3 py-2.5 text-[12px]">
          {item.resourceId ? (
            <p>
              <span className="text-foreground-muted">Record:</span> <span className="font-mono">{item.resourceId}</span>
            </p>
          ) : null}
          {item.ipAddress ? (
            <p>
              <span className="text-foreground-muted">IP:</span> <span className="font-mono">{item.ipAddress}</span>
            </p>
          ) : null}
          {Object.keys(item.metadata ?? {}).length ? <pre className="max-h-60 overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{JSON.stringify(item.metadata, null, 2)}</pre> : null}
        </div>
      ) : null}
    </li>
  );
}

export function AuditLog() {
  const canManage = useCanManage();
  const [action, setAction] = React.useState("all");
  const [actorType, setActorType] = React.useState("all");
  const query = useInfiniteQuery({
    queryKey: ["audit", action, actorType],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "50" });
      if (action !== "all") params.set("action", action);
      if (actorType !== "all") params.set("actorType", actorType);
      if (pageParam) params.set("cursor", pageParam);
      return api<AuditPage>(`/api/v1/audit?${params}`);
    },
    getNextPageParam: (last) => last.nextCursor,
    enabled: canManage,
  });

  if (!canManage) return <EmptyState icon={ScrollText} title="Admins only" description="Ask a workspace owner or admin to review the audit log." />;
  if (query.isError) return <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />;

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const areas = [...new Set((query.data?.pages[0]?.actions ?? []).map((item) => item.action.split(".")[0] ?? item.action))].sort();

  return (
    <Section title="Audit log" description="Who changed what, and when — settings, billing, team, integrations, deletions and more. Kept for the life of the workspace." icon={ScrollText}>
      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-48" aria-label="Filter by area">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All areas</SelectItem>
            {areas.map((area) => (
              <SelectItem key={area} value={area}>
                {describe(area).label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={actorType} onValueChange={setActorType}>
          <SelectTrigger className="w-44" aria-label="Filter by actor">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Anyone</SelectItem>
            <SelectItem value="USER">People</SelectItem>
            <SelectItem value="API_KEY">API keys</SelectItem>
            <SelectItem value="WORKFLOW">Workflows</SelectItem>
            <SelectItem value="SYSTEM">Reachly (system)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {!query.data ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : items.length === 0 ? (
        <EmptyState compact icon={ScrollText} title="Nothing recorded yet" description="Changes to settings, billing, the team and integrations will appear here." />
      ) : (
        <>
          <ul>
            {items.map((item) => (
              <Row key={item.id} item={item} />
            ))}
          </ul>
          {query.hasNextPage ? (
            <div className="mt-3 flex justify-center">
              <Button variant="secondary" size="sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                {query.isFetchingNextPage ? <Spinner className="size-3.5" /> : null} Load older
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Section>
  );
}
