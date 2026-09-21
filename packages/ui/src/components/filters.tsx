"use client";

import * as React from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "../lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "./overlays";

// ----------------------------------------------------------------------------- SearchInput

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className,
  debounceMs = 250,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  debounceMs?: number;
  autoFocus?: boolean;
}) {
  const [local, setLocal] = React.useState(value);
  React.useEffect(() => setLocal(value), [value]);
  React.useEffect(() => {
    if (local === value) return;
    const timer = setTimeout(() => onChange(local), debounceMs);
    return () => clearTimeout(timer);
  }, [local, value, onChange, debounceMs]);

  return (
    <div className={cn("relative flex items-center", className)}>
      <Search className="pointer-events-none absolute left-2.5 size-3.5 text-foreground-muted" />
      <input
        type="search"
        value={local}
        autoFocus={autoFocus}
        onChange={(event) => setLocal(event.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded-md border border-border bg-surface pr-7 pl-8 text-[13px] shadow-xs outline-none placeholder:text-foreground-subtle focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 [&::-webkit-search-cancel-button]:hidden"
      />
      {local ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setLocal("");
            onChange("");
          }}
          className="absolute right-1.5 rounded-sm p-0.5 text-foreground-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------------------- FilterBar

export function FilterBar({ children, className, trailing }: { children: React.ReactNode; className?: string; trailing?: React.ReactNode }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {children}
      {trailing ? <div className="ml-auto flex items-center gap-2">{trailing}</div> : null}
    </div>
  );
}

/** A dropdown chip that toggles multiple values of one dimension. */
export function FilterChip<T extends string>({
  label,
  options,
  selected,
  onChange,
  single = false,
}: {
  label: string;
  options: Array<{ value: T; label: string; count?: number }>;
  selected: T[];
  onChange: (values: T[]) => void;
  single?: boolean;
}) {
  const active = selected.length > 0;
  const summary = active
    ? selected.length === 1
      ? (options.find((option) => option.value === selected[0])?.label ?? selected[0])
      : `${selected.length} selected`
    : null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors",
            active
              ? "border-accent/40 bg-accent-soft text-accent-soft-foreground"
              : "border-dashed border-border-strong text-foreground-secondary hover:bg-surface-muted",
          )}
        >
          {label}
          {summary ? <span className="font-semibold">: {summary}</span> : null}
          <ChevronDown className="size-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1">
        <div className="max-h-64 overflow-y-auto">
          {options.map((option) => {
            const checked = selected.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  if (single) onChange(checked ? [] : [option.value]);
                  else onChange(checked ? selected.filter((value) => value !== option.value) : [...selected, option.value]);
                }}
                className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[13px] hover:bg-surface-muted"
              >
                <span
                  className={cn(
                    "flex size-4 items-center justify-center rounded-[4px] border",
                    checked ? "border-primary bg-primary text-primary-foreground" : "border-border-strong",
                  )}
                >
                  {checked ? <Check className="size-3" strokeWidth={3} /> : null}
                </span>
                <span className="flex-1 truncate">{option.label}</span>
                {option.count !== undefined ? <span className="text-[11px] text-foreground-muted tabular">{option.count}</span> : null}
              </button>
            );
          })}
        </div>
        {active ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="mt-1 flex h-8 w-full items-center justify-center rounded-sm border-t border-border text-xs text-foreground-muted hover:text-foreground"
          >
            Clear
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
