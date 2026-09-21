"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@repo/ui";

/** Chip input for short string lists (industries, keywords, locations). Enter or comma adds. */
export function TagInput({
  value,
  onChange,
  placeholder = "Type and press Enter",
  suggestions = [],
  max = 20,
  id,
  className,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  max?: number;
  id?: string;
  className?: string;
}) {
  const [draft, setDraft] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  function add(raw: string) {
    const tag = raw.trim().replace(/,$/, "");
    if (!tag || value.some((item) => item.toLowerCase() === tag.toLowerCase()) || value.length >= max) return;
    onChange([...value, tag]);
  }

  const available = suggestions.filter((suggestion) => !value.some((item) => item.toLowerCase() === suggestion.toLowerCase()));

  return (
    <div className={className}>
      <div
        className="flex min-h-8 w-full cursor-text flex-wrap items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-1 shadow-xs focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <span key={tag} className="inline-flex h-6 items-center gap-1 rounded-[4px] bg-surface-muted pr-1 pl-2 text-xs font-medium text-foreground-secondary">
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={(event) => {
                event.stopPropagation();
                onChange(value.filter((item) => item !== tag));
              }}
              className="rounded-sm p-0.5 text-foreground-muted hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          value={draft}
          onChange={(event) => {
            const next = event.target.value;
            if (next.endsWith(",")) {
              add(next);
              setDraft("");
            } else setDraft(next);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add(draft);
              setDraft("");
            } else if (event.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => {
            if (draft) {
              add(draft);
              setDraft("");
            }
          }}
          placeholder={value.length ? "" : placeholder}
          className="h-6 min-w-24 flex-1 bg-transparent px-1 text-[13px] outline-none placeholder:text-foreground-subtle"
        />
      </div>
      {available.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {available.slice(0, 8).map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => add(suggestion)}
              className={cn(
                "inline-flex h-6 items-center rounded-[4px] border border-dashed border-border-strong px-2 text-xs text-foreground-muted transition-colors hover:border-foreground-muted hover:text-foreground",
              )}
            >
              + {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
