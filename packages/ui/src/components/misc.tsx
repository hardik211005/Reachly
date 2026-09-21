"use client";

import * as React from "react";
import { Avatar as AvatarPrimitive, Progress as ProgressPrimitive, Separator as SeparatorPrimitive } from "radix-ui";
import { cn, initials } from "../lib/utils";

export function Separator({ className, orientation = "horizontal", ...props }: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      className={cn("shrink-0 bg-border", orientation === "horizontal" ? "h-px w-full" : "h-full w-px", className)}
      {...props}
    />
  );
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--surface-muted)_25%,var(--surface-sunken)_37%,var(--surface-muted)_63%)] bg-[length:400%_100%]",
        className,
      )}
      {...props}
    />
  );
}

export function Avatar({
  name,
  src,
  className,
  size = "md",
}: {
  name: string | null | undefined;
  src?: string | null;
  className?: string;
  size?: "xs" | "sm" | "md" | "lg";
}) {
  const sizes = { xs: "size-5 text-[9px]", sm: "size-6 text-[10px]", md: "size-8 text-xs", lg: "size-10 text-sm" };
  return (
    <AvatarPrimitive.Root className={cn("relative flex shrink-0 overflow-hidden rounded-full", sizes[size], className)}>
      {src ? <AvatarPrimitive.Image src={src} alt={name ?? ""} className="aspect-square size-full object-cover" /> : null}
      <AvatarPrimitive.Fallback className="flex size-full items-center justify-center bg-surface-sunken font-medium text-foreground-secondary">
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

/** Company logo placeholder: a quiet monogram tile. */
export function CompanyMark({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface-muted text-[11px] font-semibold text-foreground-secondary",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

export function Progress({
  value,
  className,
  tone = "accent",
}: {
  value: number;
  className?: string;
  tone?: "accent" | "warning" | "danger" | "neutral";
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const fill = { accent: "bg-accent", warning: "bg-warning", danger: "bg-critical", neutral: "bg-foreground-muted" }[tone];
  const track = { accent: "bg-accent-soft", warning: "bg-warning-soft", danger: "bg-danger-soft", neutral: "bg-surface-sunken" }[tone];
  return (
    <ProgressPrimitive.Root value={clamped} className={cn("relative h-1.5 w-full overflow-hidden rounded-full", track, className)}>
      <ProgressPrimitive.Indicator
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out", fill)}
        style={{ width: `${clamped}%` }}
      />
    </ProgressPrimitive.Root>
  );
}

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-border bg-surface-muted px-1 font-sans text-[11px] font-medium text-foreground-muted",
        className,
      )}
      {...props}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn("inline-block size-4 animate-spin rounded-full border-2 border-border-strong border-t-foreground", className)}
    />
  );
}
