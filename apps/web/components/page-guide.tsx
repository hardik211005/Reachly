"use client";

import * as React from "react";
import { HelpCircle, X } from "lucide-react";
import { Button } from "@repo/ui";

/**
 * A short "how this works" strip for owners who are new to tools like this: three plain steps.
 * Dismissed per page (remembered in this browser); a small link brings it back.
 */

const listeners = new Set<() => void>();
const key = (id: string) => `guide-hidden:${id}`;
function read(id: string): boolean {
  try {
    return localStorage.getItem(key(id)) === "1";
  } catch {
    return false;
  }
}
function write(id: string, hidden: boolean) {
  try {
    localStorage.setItem(key(id), hidden ? "1" : "0");
  } catch {
    /* storage unavailable: it just shows again */
  }
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function PageGuide({
  id,
  title,
  steps,
}: {
  id: string;
  title: string;
  steps: Array<{ title: string; body: string }>;
}) {
  // Server render shows the guide; the browser hides it if it was dismissed before.
  const hidden = React.useSyncExternalStore(
    subscribe,
    () => read(id),
    () => false,
  );
  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => write(id, false)}
        className="flex w-fit items-center gap-1.5 text-[12px] text-foreground-muted hover:text-foreground"
      >
        <HelpCircle className="size-3.5" /> {title}
      </button>
    );
  }
  return (
    <section
      className="relative rounded-xl border border-border bg-accent-soft/30 px-4 py-3.5"
      aria-label={title}
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[13.5px] font-semibold">
          <HelpCircle className="size-4 text-brand-1" /> {title}
        </h2>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Hide this guide"
          onClick={() => write(id, true)}
        >
          <X />
        </Button>
      </div>
      <ol className="grid gap-3 sm:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-2.5">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface text-[12px] font-semibold text-brand-1 shadow-xs">
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-medium">{step.title}</p>
              <p className="text-[12.5px] leading-relaxed text-foreground-secondary">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
