"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle, Rocket, X } from "lucide-react";
import { Button, cn } from "@repo/ui";

interface Step {
  key: string;
  title: string;
  why: string;
  href: string;
  cta: string;
  done: boolean;
}

const HIDE_KEY = "setup-checklist-hidden";
const listeners = new Set<() => void>();
const readHidden = () => {
  try {
    return localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const setHidden = (value: boolean) => {
  try {
    localStorage.setItem(HIDE_KEY, value ? "1" : "0");
  } catch {
    /* storage unavailable: it just shows again next time */
  }
  listeners.forEach((listener) => listener());
};

/** "Getting started": the few steps that make Reachly work for a business, ticked off from real data. */
export function SetupChecklist({
  steps,
  done,
  total,
  className,
}: {
  steps: Step[];
  done: number;
  total: number;
  className?: string;
}) {
  const hidden = React.useSyncExternalStore(subscribe, readHidden, () => false);
  if (done >= total) return null;
  const next = steps.find((step) => !step.done);
  const percent = Math.round((done / total) * 100);

  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => setHidden(false)}
        className="col-span-full flex w-fit items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-[12.5px] text-foreground-secondary shadow-xs hover:text-foreground"
      >
        <Rocket className="size-3.5 text-brand-1" /> Getting started · {done} of {total} done
      </button>
    );
  }
  return (
    // A tile of the Today bento; the page grid owns the spacing, so nothing touches and no gap is left once finished.
    <section
      className={cn(
        "min-w-0 overflow-hidden rounded-xl border border-border bg-surface shadow-xs",
        className,
      )}
      aria-labelledby="setup-title"
    >
      <header className="flex items-start gap-3 border-b border-border px-5 py-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-soft-foreground">
          <Rocket className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="setup-title" className="text-[15px] font-semibold">
            Getting started
          </h2>
          <p className="mt-0.5 text-[12.5px] text-foreground-muted">
            {done} of {total} done — each step takes a couple of minutes.
          </p>
          <div className="mt-2 h-1.5 max-w-sm overflow-hidden rounded-full bg-surface-muted">
            <div
              className="h-full rounded-full bg-brand-1 transition-[width] duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Hide getting started"
          onClick={() => setHidden(true)}
        >
          <X />
        </Button>
      </header>
      <ol className="divide-y divide-border">
        {/* Finished steps are counted in the header, not listed, to keep this short. */}
        {steps
          .filter((step) => !step.done)
          .map((step) => {
            const isNext = step.key === next?.key;
            return (
              <li
                key={step.key}
                className={cn(
                  "flex flex-wrap items-center gap-3 px-5 py-3 sm:flex-nowrap",
                  isNext && "bg-accent-soft/30",
                )}
              >
                {step.done ? (
                  <CheckCircle2 className="size-5 shrink-0 text-success-text" aria-label="Done" />
                ) : (
                  <Circle
                    className={cn(
                      "size-5 shrink-0",
                      isNext ? "text-brand-1" : "text-border-strong",
                    )}
                    aria-label="Not done yet"
                  />
                )}
                <div className="min-w-0 flex-1 basis-[calc(100%-2rem)] sm:basis-auto">
                  <p
                    className={cn(
                      "text-[13.5px] font-medium",
                      step.done &&
                        "text-foreground-muted line-through decoration-foreground-subtle",
                    )}
                  >
                    {step.title}
                  </p>
                  {step.done ? null : (
                    <p className="text-[12.5px] leading-relaxed text-foreground-muted">
                      {step.why}
                    </p>
                  )}
                </div>
                {step.done ? null : (
                  <Button
                    asChild
                    size="sm"
                    variant={isNext ? "primary" : "secondary"}
                    className="ml-8 sm:ml-0"
                  >
                    <Link href={step.href}>
                      {step.cta} <ArrowRight />
                    </Link>
                  </Button>
                )}
              </li>
            );
          })}
      </ol>
    </section>
  );
}
