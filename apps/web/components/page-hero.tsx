"use client";

import { Aurora, Stagger, StaggerItem } from "@repo/ui";

/**
 * Page header with the brand glow: title, one-line description and actions. `highlight` is a
 * word from the title rendered in the brand gradient.
 */
export function PageHero({ title, highlight, description, actions, eyebrow }: { title: string; highlight?: string; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  const [before, after] = highlight && title.includes(highlight) ? title.split(highlight) : [title, undefined];
  return (
    <section className="relative isolate overflow-hidden rounded-xl border border-border bg-surface px-5 py-5 shadow-xs sm:px-6">
      <Aurora intensity={0.8} className="-z-10" />
      <div aria-hidden className="bg-grid absolute inset-0 -z-10 opacity-40 [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_65%)]" />
      <Stagger step={0.07} className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <StaggerItem>
              <div className="mb-1 text-xs font-medium tracking-wide text-foreground-muted uppercase">{eyebrow}</div>
            </StaggerItem>
          ) : null}
          <StaggerItem>
            <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.03em]">
              {before}
              {highlight && after !== undefined ? <span className="text-gradient animate-gradient-pan">{highlight}</span> : null}
              {after}
            </h1>
          </StaggerItem>
          {description ? (
            <StaggerItem>
              <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-foreground-secondary">{description}</p>
            </StaggerItem>
          ) : null}
        </div>
        {actions ? (
          <StaggerItem>
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          </StaggerItem>
        ) : null}
      </Stagger>
    </section>
  );
}
