"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FileText, HelpCircle, Layers, Search, Users } from "lucide-react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, Kbd, cn } from "@repo/ui";
import { buildSearchIndex, type SearchEntry } from "./site";

const GROUP_ICON: Record<SearchEntry["group"], React.ComponentType<{ className?: string }>> = {
  Pages: FileText,
  Features: Layers,
  "Use cases": Users,
  Questions: HelpCircle,
};
const GROUP_ORDER: Array<SearchEntry["group"]> = ["Pages", "Features", "Use cases", "Questions"];

/** Every query word must appear somewhere; title hits rank above description and keyword hits. */
function rank(entries: SearchEntry[], query: string): SearchEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return entries;
  const scored: Array<{ entry: SearchEntry; score: number }> = [];
  for (const entry of entries) {
    const title = entry.title.toLowerCase();
    const rest = `${entry.description} ${entry.keywords}`.toLowerCase();
    let score = 0;
    let matched = true;
    for (const word of words) {
      if (title.startsWith(word)) score += 6;
      else if (title.includes(word)) score += 4;
      else if (rest.includes(word)) score += 1;
      else {
        matched = false;
        break;
      }
    }
    if (matched) scored.push({ entry, score: score + (entry.group === "Features" && !entry.href.includes("#") ? 2 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score).map((item) => item.entry);
}

const PER_GROUP = 6;

const SearchContext = React.createContext<{ open: () => void } | null>(null);

export function useSiteSearch() {
  const context = React.useContext(SearchContext);
  if (!context) throw new Error("useSiteSearch must be used inside SiteSearchProvider");
  return context;
}

/** Site-wide search over pages, features, use cases and FAQs. Opens with ⌘K, Ctrl+K or "/". */
export function SiteSearchProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const index = React.useMemo(() => buildSearchIndex(), []);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((event.key === "k" && (event.metaKey || event.ctrlKey)) || (event.key === "/" && !typing)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  // With no query, show a short list of useful destinations instead of everything.
  const visible = query.trim() ? rank(index, query) : index.filter((entry) => entry.group === "Pages" || (entry.group === "Features" && !entry.href.includes("#")));
  // Groups appear in order of their best match.
  const groups = query.trim() ? [...new Set(visible.map((entry) => entry.group))] : GROUP_ORDER;
  const value = React.useMemo(() => ({ open: () => setOpen(true) }), []);

  return (
    <SearchContext.Provider value={value}>
      {children}
      <CommandDialog open={open} onOpenChange={setOpen} label="Search the site" shouldFilter={false}>
        <CommandInput value={query} onValueChange={setQuery} placeholder="Search features, pages and questions…" />
        <CommandList className="max-h-[60vh]">
          <CommandEmpty>
            <div className="py-6 text-center text-[13px] text-foreground-muted">
              No results for “{query}”.{" "}
              <button type="button" className="font-medium text-foreground underline underline-offset-2" onClick={() => go("/contact")}>
                Ask us instead
              </button>
            </div>
          </CommandEmpty>
          {groups.map((group) => {
            const entries = visible.filter((entry) => entry.group === group).slice(0, query.trim() ? PER_GROUP : undefined);
            if (!entries.length) return null;
            const Icon = GROUP_ICON[group];
            return (
              <CommandGroup key={group} heading={group}>
                {entries.map((entry) => (
                  <CommandItem key={entry.id} value={entry.id} onSelect={() => go(entry.href)} className="group h-auto items-start gap-3 py-2">
                    <Icon className="mt-0.5 size-4 shrink-0 text-foreground-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-medium">{entry.title}</span>
                      <span className="line-clamp-1 text-[12px] text-foreground-muted">{entry.description}</span>
                    </span>
                    <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-foreground-subtle opacity-0 transition-opacity group-data-[selected=true]:opacity-100" />
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          })}
        </CommandList>
        <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-foreground-muted">
          <span className="inline-flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> to move
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>↵</Kbd> to open
          </span>
          <span className="ml-auto inline-flex items-center gap-1">
            <Kbd>esc</Kbd> to close
          </span>
        </div>
      </CommandDialog>
    </SearchContext.Provider>
  );
}

export function SearchButton({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { open } = useSiteSearch();
  return (
    <button
      type="button"
      onClick={open}
      aria-label="Search the site"
      className={cn(
        "group inline-flex items-center gap-2 rounded-lg border border-border bg-surface/70 text-[12.5px] text-foreground-muted backdrop-blur transition-colors hover:border-border-strong hover:text-foreground",
        compact ? "size-9 justify-center" : "h-9 w-48 px-3",
        className,
      )}
    >
      <Search className="size-4 shrink-0" />
      {compact ? null : (
        <>
          <span className="flex-1 text-left">Search…</span>
          <Kbd className="text-[10.5px]">⌘K</Kbd>
        </>
      )}
    </button>
  );
}
