"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { Ban, Columns3, Download, Eye, RefreshCw, Tag, Trash2, UserRound, Users, X } from "lucide-react";
import { LEAD_STATUS_LABELS, LEAD_STATUSES, type LeadStatus } from "@repo/config";
import {
  Badge,
  Button,
  DataTable,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  FilterBar,
  FilterChip,
  ScoreIndicator,
  SearchInput,
  cn,
  formatNumber,
  toast,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@repo/ui";
import { apiWithMeta, api, errorMessage } from "@/lib/api-client";
import { useLocalStorageState } from "@/lib/use-local-storage";
import { useCanWrite } from "../shell/shell-context";
import { AddToCampaignMenu, ContactIndicators, FitBadge, LeadStatusBadge, SourceLabel } from "./shared";

export interface LeadRow {
  id: string;
  name: string;
  category: string | null;
  industry: string | null;
  city: string | null;
  locality: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  score: number | null;
  fitTier: "HIGH" | "MEDIUM" | "LOW" | null;
  status: LeadStatus;
  sourceProvider: string;
  lastActivityAt: string | null;
  nextAction: string | null;
  nextActionAt: string | null;
  createdAt: string;
  tags: string[];
  primaryCampaign: { id: string; name: string } | null;
  owner: { id: string; name: string } | null;
  contacts: Array<{ id: string; name: string | null; title: string | null; email: string | null; phone: string | null }>;
}

interface ListMeta {
  total: number;
  page: number;
  pageSize: number;
  facets: { status: Partial<Record<LeadStatus, number>> };
}

interface FilterOptions {
  cities: Array<{ value: string; count: number }>;
  categories: Array<{ value: string; count: number }>;
  sources: Array<{ value: string; count: number }>;
  campaigns: Array<{ id: string; name: string; status: string }>;
}

interface SavedView {
  id: string;
  name: string;
  filters: Record<string, string>;
}

const STATUS_TABS: Array<LeadStatus | "ALL"> = ["ALL", "NEW", "QUALIFIED", "CONTACTED", "REPLIED", "INTERESTED", "MEETING", "WON"];
const FILTER_KEYS = ["q", "status", "fitTier", "city", "category", "source", "campaignId", "minScore", "hasEmail", "sort", "order"] as const;
const COLUMN_LABELS: Record<string, string> = {
  score: "Score",
  name: "Business",
  industry: "Industry",
  location: "Location",
  contact: "Contact",
  source: "Source",
  campaign: "Campaign",
  status: "Status",
  lastActivity: "Last activity",
  nextAction: "Next action",
};
const COLUMN_STORAGE = "leads-columns";

function humanize(key: string | null): string {
  return key ? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—";
}

export function LeadsTable() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = useLocalStorageState<VisibilityState>(COLUMN_STORAGE, {});

  const page = Number(params.get("page") ?? 1);
  const sort = params.get("sort") ?? "score";
  const order = (params.get("order") ?? "desc") as "asc" | "desc";
  const statusParam = params.get("status");
  const listKey = params.toString();

  const setParams = React.useCallback(
    (patch: Record<string, string | null>, resetPage = true) => {
      const next = new URLSearchParams(params);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      if (resetPage && !("page" in patch)) next.delete("page");
      setRowSelection({});
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const leads = useQuery({
    queryKey: ["leads", listKey],
    queryFn: () => apiWithMeta<LeadRow[], ListMeta>(`/api/v1/leads?${new URLSearchParams({ pageSize: "25", ...Object.fromEntries(params) }).toString()}`),
    placeholderData: keepPreviousData,
  });
  const options = useQuery({ queryKey: ["lead-filters"], queryFn: () => api<FilterOptions>("/api/v1/leads/filters"), staleTime: 60_000 });
  const views = useQuery({ queryKey: ["saved-views", "leads"], queryFn: () => api<SavedView[]>("/api/v1/saved-views?resource=leads") });

  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);

  const bulk = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ affected: number }>("/api/v1/leads/bulk", { method: "POST", json: { ...body, ids: selectedIds } }),
    onSuccess: (result, body) => {
      toast.success(`${body.action === "rescore" ? "Re-scoring" : "Updated"} ${result.affected} lead${result.affected === 1 ? "" : "s"}`);
      setRowSelection({});
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const saveView = useMutation({
    mutationFn: (name: string) => {
      const filters = Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key)]).filter(([, value]) => value));
      return api("/api/v1/saved-views", { method: "POST", json: { resource: "leads", name, filters, columns: Object.keys(columnVisibility).filter((key) => columnVisibility[key] === false) } });
    },
    onSuccess: () => {
      toast.success("View saved");
      void queryClient.invalidateQueries({ queryKey: ["saved-views", "leads"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const updateColumns = setColumnVisibility;

  const columns = React.useMemo<ColumnDef<LeadRow, unknown>[]>(
    () => [
      { id: "score", accessorKey: "score", header: "Score", size: 64, enableHiding: false, cell: ({ row }) => <ScoreIndicator score={row.original.score} /> },
      {
        id: "name",
        accessorKey: "name",
        header: "Business",
        enableHiding: false,
        cell: ({ row }) => (
          <div className="max-w-[260px] min-w-[160px]">
            <Link href={`/app/leads/${row.original.id}`} onClick={(event) => event.stopPropagation()} className="block truncate font-medium hover:underline">
              {row.original.name}
            </Link>
            <p className="truncate text-xs text-foreground-muted">{row.original.website?.replace(/^https?:\/\//, "") ?? humanize(row.original.category)}</p>
          </div>
        ),
      },
      { id: "industry", header: "Industry", enableSorting: false, cell: ({ row }) => <span className="text-foreground-secondary">{row.original.industry ?? humanize(row.original.category)}</span> },
      {
        id: "location",
        accessorKey: "city",
        header: "Location",
        cell: ({ row }) => <span className="whitespace-nowrap text-foreground-secondary">{[row.original.locality, row.original.city].filter(Boolean).join(", ") || "—"}</span>,
      },
      {
        id: "contact",
        header: "Contact",
        enableSorting: false,
        cell: ({ row }) => {
          const contact = row.original.contacts[0];
          return (
            <div className="flex items-center gap-2">
              <ContactIndicators email={row.original.email ?? contact?.email} phone={row.original.phone ?? contact?.phone} />
              {contact?.name ? <span className="hidden truncate text-xs text-foreground-muted 2xl:inline">{contact.name}</span> : null}
            </div>
          );
        },
      },
      { id: "source", header: "Source", enableSorting: false, cell: ({ row }) => <SourceLabel provider={row.original.sourceProvider} /> },
      {
        id: "campaign",
        header: "Campaign",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.primaryCampaign ? (
            <Link href={`/app/campaigns/${row.original.primaryCampaign.id}`} onClick={(event) => event.stopPropagation()} className="truncate text-foreground-secondary hover:underline">
              {row.original.primaryCampaign.name}
            </Link>
          ) : (
            <span className="text-foreground-subtle">—</span>
          ),
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <LeadStatusBadge status={row.original.status} />
            {row.original.fitTier === "HIGH" ? <FitBadge tier="HIGH" /> : null}
          </div>
        ),
      },
      {
        id: "lastActivity",
        accessorKey: "lastActivityAt",
        header: "Last activity",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-foreground-muted">
            {row.original.lastActivityAt ? formatDistanceToNowStrict(new Date(row.original.lastActivityAt), { addSuffix: true }) : "—"}
          </span>
        ),
      },
      {
        id: "nextAction",
        header: "Next action",
        enableSorting: false,
        cell: ({ row }) => <span className="truncate text-xs text-foreground-secondary">{row.original.nextAction ?? "—"}</span>,
      },
    ],
    [],
  );

  const sorting: SortingState = [{ id: sort === "city" ? "location" : sort === "lastActivityAt" ? "lastActivity" : sort, desc: order === "desc" }];
  const meta = leads.data?.meta;
  const facets = meta?.facets.status ?? {};
  const allCount = Object.entries(facets).filter(([status]) => status !== "DO_NOT_CONTACT").reduce((sum, [, count]) => sum + (count ?? 0), 0);
  const activeFilters = FILTER_KEYS.filter((key) => !["sort", "order", "status"].includes(key) && params.get(key)).length;

  return (
    <div className="grid gap-3">
      <div className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1">
        {STATUS_TABS.map((tab) => {
          const active = tab === "ALL" ? !statusParam : statusParam === tab;
          const count = tab === "ALL" ? allCount : (facets[tab] ?? 0);
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setParams({ status: tab === "ALL" ? null : tab })}
              className={cn(
                "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors",
                active ? "bg-surface text-foreground shadow-xs ring-1 ring-border" : "text-foreground-muted hover:text-foreground",
              )}
            >
              {tab === "ALL" ? "All" : LEAD_STATUS_LABELS[tab]}
              <span className="text-[11px] text-foreground-subtle tabular">{formatNumber(count)}</span>
            </button>
          );
        })}
      </div>

      <FilterBar
        trailing={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Eye /> Views
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Saved views</DropdownMenuLabel>
                {(views.data ?? []).length === 0 ? <p className="px-2 pb-2 text-xs text-foreground-muted">No saved views yet.</p> : null}
                {(views.data ?? []).map((view) => (
                  <DropdownMenuItem key={view.id} onSelect={() => router.replace(`${pathname}?${new URLSearchParams(view.filters).toString()}`)}>
                    {view.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    const name = window.prompt("Name this view");
                    if (name?.trim()) saveView.mutate(name.trim());
                  }}
                >
                  Save current view…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Columns3 /> Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {Object.entries(COLUMN_LABELS)
                  .filter(([key]) => key !== "score" && key !== "name")
                  .map(([key, label]) => (
                    <DropdownMenuCheckboxItem
                      key={key}
                      checked={columnVisibility[key] !== false}
                      onCheckedChange={(checked) => updateColumns({ ...columnVisibility, [key]: checked === true })}
                      onSelect={(event) => event.preventDefault()}
                    >
                      {label}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      >
        <SearchInput value={params.get("q") ?? ""} onChange={(q) => setParams({ q })} placeholder="Search name, domain, city, phone…" className="w-full sm:w-72" />
        <FilterChip
          label="Fit"
          options={[
            { value: "HIGH", label: "High fit" },
            { value: "MEDIUM", label: "Medium" },
            { value: "LOW", label: "Low" },
          ]}
          selected={(params.get("fitTier") ?? "").split(",").filter(Boolean) as Array<"HIGH" | "MEDIUM" | "LOW">}
          onChange={(values) => setParams({ fitTier: values.join(",") })}
        />
        <FilterChip
          label="Score"
          single
          options={[
            { value: "80", label: "80 and above" },
            { value: "60", label: "60 and above" },
            { value: "40", label: "40 and above" },
          ]}
          selected={params.get("minScore") ? [params.get("minScore") as string] : []}
          onChange={(values) => setParams({ minScore: values[0] ?? null })}
        />
        <FilterChip
          label="City"
          options={(options.data?.cities ?? []).map((city) => ({ value: city.value, label: city.value, count: city.count }))}
          selected={(params.get("city") ?? "").split(",").filter(Boolean)}
          onChange={(values) => setParams({ city: values.join(",") })}
        />
        <FilterChip
          label="Category"
          options={(options.data?.categories ?? []).map((category) => ({ value: category.value, label: humanize(category.value), count: category.count }))}
          selected={(params.get("category") ?? "").split(",").filter(Boolean)}
          onChange={(values) => setParams({ category: values.join(",") })}
        />
        <FilterChip
          label="Source"
          options={(options.data?.sources ?? []).map((source) => ({ value: source.value, label: source.value === "mock" ? "Demo data" : humanize(source.value), count: source.count }))}
          selected={(params.get("source") ?? "").split(",").filter(Boolean)}
          onChange={(values) => setParams({ source: values.join(",") })}
        />
        <FilterChip
          label="Campaign"
          single
          options={(options.data?.campaigns ?? []).map((campaign) => ({ value: campaign.id, label: campaign.name }))}
          selected={params.get("campaignId") ? [params.get("campaignId") as string] : []}
          onChange={(values) => setParams({ campaignId: values[0] ?? null })}
        />
        <FilterChip
          label="Has email"
          single
          options={[{ value: "true", label: "Only leads with email" }]}
          selected={params.get("hasEmail") ? ["true"] : []}
          onChange={(values) => setParams({ hasEmail: values[0] ?? null })}
        />
        {activeFilters ? (
          <Button variant="ghost" size="xs" onClick={() => router.replace(`${pathname}${statusParam ? `?status=${statusParam}` : ""}`)}>
            <X /> Clear
          </Button>
        ) : null}
      </FilterBar>

      {selectedIds.length && canWrite ? (
        <div className="sticky top-12 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 shadow-md animate-slide-up">
          <Badge tone="solid">{selectedIds.length} selected</Badge>
          <AddToCampaignMenu leadIds={selectedIds} onDone={() => setRowSelection({})} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">Change status</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {LEAD_STATUSES.filter((status) => status !== "DO_NOT_CONTACT").map((status) => (
                <DropdownMenuItem key={status} onSelect={() => bulk.mutate({ action: "status", status })}>
                  {LEAD_STATUS_LABELS[status]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" onClick={() => bulk.mutate({ action: "rescore" })} loading={bulk.isPending && bulk.variables?.action === "rescore"}>
            <RefreshCw /> Re-score
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost">
                More
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => bulk.mutate({ action: "assign", ownerId: null })}>
                <UserRound /> Unassign owner
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Tag /> Add tag
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {["priority", "follow-up", "enterprise", "local"].map((tag) => (
                    <DropdownMenuItem key={tag} onSelect={() => bulk.mutate({ action: "tag", tag })}>
                      {tag}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem asChild>
                <a href={`/api/v1/leads/export?ids=${selectedIds.join(",")}`} download>
                  <Download /> Export selected
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive
                onSelect={() => {
                  if (window.confirm(`Mark ${selectedIds.length} lead(s) as do-not-contact? They will be suppressed from all outreach.`)) bulk.mutate({ action: "do_not_contact" });
                }}
              >
                <Ban /> Mark do-not-contact
              </DropdownMenuItem>
              <DropdownMenuItem
                destructive
                onSelect={() => {
                  if (window.confirm(`Delete ${selectedIds.length} lead(s)?`)) bulk.mutate({ action: "delete" });
                }}
              >
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Clear selection" onClick={() => setRowSelection({})}>
            <X />
          </Button>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
        {leads.isError ? (
          <ErrorState description={errorMessage(leads.error)} onRetry={() => void leads.refetch()} />
        ) : (
          <DataTable
            data={leads.data?.data ?? []}
            columns={columns}
            getRowId={(row) => row.id}
            selectable={canWrite}
            rowSelection={rowSelection}
            onRowSelectionChange={setRowSelection}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={(updater) => updateColumns(typeof updater === "function" ? updater(columnVisibility) : updater)}
            sorting={sorting}
            onSortingChange={(updater) => {
              const next = typeof updater === "function" ? updater(sorting) : updater;
              const first = next[0];
              const field = first?.id === "location" ? "city" : first?.id === "lastActivity" ? "lastActivityAt" : (first?.id ?? "score");
              setParams({ sort: field, order: first?.desc === false ? "asc" : "desc" });
            }}
            onRowClick={(row) => router.push(`/app/leads/${row.id}`)}
            loading={leads.isLoading}
            refetching={leads.isFetching && !leads.isLoading}
            pagination={meta ? { page, pageSize: meta.pageSize, total: meta.total, onPageChange: (next) => setParams({ page: String(next) }, false) } : undefined}
            empty={
              <EmptyState
                icon={Users}
                title={activeFilters || statusParam ? "No leads match these filters" : "No leads yet"}
                description={activeFilters || statusParam ? "Try removing a filter." : "Discover businesses that match your ideal customer, or import a CSV."}
                action={
                  activeFilters || statusParam ? undefined : (
                    <Button asChild variant="primary" size="sm">
                      <Link href="/app/discover">Find leads</Link>
                    </Button>
                  )
                }
              />
            }
          />
        )}
      </div>
    </div>
  );
}
