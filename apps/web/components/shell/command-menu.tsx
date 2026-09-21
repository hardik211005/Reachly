"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Building2, KanbanSquare, Megaphone, MessagesSquare, Moon, Plus, Sun, Telescope, UserRound } from "lucide-react";
import { useTheme } from "next-themes";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  Spinner,
} from "@repo/ui";
import { api } from "@/lib/api-client";
import { ALL_NAV_ITEMS } from "./nav";
import { useCanManage } from "./shell-context";

interface SearchResult {
  type: "lead" | "contact" | "campaign" | "conversation" | "deal";
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

const RESULT_ICONS = {
  lead: Building2,
  contact: UserRound,
  campaign: Megaphone,
  conversation: MessagesSquare,
  deal: KanbanSquare,
} as const;

const RESULT_LABELS: Record<SearchResult["type"], string> = {
  lead: "Leads",
  contact: "Contacts",
  campaign: "Campaigns",
  conversation: "Conversations",
  deal: "Deals",
};

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const canManage = useCanManage();
  const [query, setQuery] = React.useState("");
  const debounced = useDebounced(query.trim(), 200);

  const search = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api<SearchResult[]>(`/api/v1/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && debounced.length >= 2,
    staleTime: 10_000,
  });

  function handleOpenChange(next: boolean) {
    if (!next) setQuery("");
    onOpenChange(next);
  }

  function go(href: string) {
    handleOpenChange(false);
    router.push(href);
  }

  const grouped = (search.data ?? []).reduce<Record<string, SearchResult[]>>((acc, result) => {
    (acc[result.type] ??= []).push(result);
    return acc;
  }, {});

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange} shouldFilter={debounced.length < 2}>
      <CommandInput value={query} onValueChange={setQuery} placeholder="Search leads, campaigns, deals… or jump to a page" />
      <CommandList>
        {debounced.length >= 2 ? (
          <>
            {search.isFetching && !search.data ? (
              <div className="flex items-center justify-center py-8">
                <Spinner />
              </div>
            ) : null}
            {search.data && search.data.length === 0 ? <CommandEmpty>No matches for “{debounced}”.</CommandEmpty> : null}
            {Object.entries(grouped).map(([type, results]) => (
              <CommandGroup key={type} heading={RESULT_LABELS[type as SearchResult["type"]]}>
                {results.map((result) => {
                  const Icon = RESULT_ICONS[result.type];
                  return (
                    <CommandItem key={`${result.type}:${result.id}`} value={`${result.type}:${result.id}`} onSelect={() => go(result.href)}>
                      <Icon />
                      <span className="truncate">{result.title}</span>
                      {result.subtitle ? <span className="truncate text-xs text-foreground-muted">{result.subtitle}</span> : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </>
        ) : (
          <>
            <CommandEmpty>No matching pages.</CommandEmpty>
            <CommandGroup heading="Quick actions">
              <CommandItem onSelect={() => go("/app/discover")}>
                <Telescope /> Find new leads
              </CommandItem>
              <CommandItem onSelect={() => go("/app/campaigns/new")}>
                <Plus /> New campaign
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  setTheme(resolvedTheme === "dark" ? "light" : "dark");
                  handleOpenChange(false);
                }}
              >
                {resolvedTheme === "dark" ? <Sun /> : <Moon />} Toggle theme
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Go to">
              {ALL_NAV_ITEMS.filter((item) => !item.adminOnly || canManage).map((item) => (
                <CommandItem key={item.href} value={`go ${item.label}`} onSelect={() => go(item.href)}>
                  <item.icon />
                  {item.label}
                  {item.shortcut ? <CommandShortcut>G {item.shortcut.toUpperCase()}</CommandShortcut> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
