"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight, Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Aurora, Button, EASE_OUT, Reveal, cn } from "@repo/ui";

/** Splits `title` around `highlight` and renders the highlight in the brand gradient. */
export function Highlighted({ title, highlight, animate = false }: { title: string; highlight?: string; animate?: boolean }) {
  if (!highlight || !title.includes(highlight)) return <>{title}</>;
  const [before, after] = title.split(highlight);
  return (
    <>
      {before}
      <span className={cn("text-gradient", animate && "animate-gradient-pan")}>{highlight}</span>
      {after}
    </>
  );
}

export function SectionHeading({ eyebrow, title, highlight, description, center = true, className }: { eyebrow: string; title: string; highlight?: string; description?: React.ReactNode; center?: boolean; className?: string }) {
  return (
    <Reveal className={cn("max-w-2xl", center && "mx-auto text-center", className)}>
      <p className="text-xs font-semibold tracking-[0.14em] text-brand-1 uppercase">{eyebrow}</p>
      <h2 className="mt-3 text-[32px] leading-[1.1] font-semibold tracking-[-0.03em] text-balance sm:text-[40px]">
        <Highlighted title={title} highlight={highlight} />
      </h2>
      {description ? <p className="mt-4 text-[15px] leading-relaxed text-foreground-secondary">{description}</p> : null}
    </Reveal>
  );
}

const rise = { hidden: { opacity: 0, y: 18, filter: "blur(6px)" }, show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.6, ease: EASE_OUT } } };

/** Top of every inner page: breadcrumbs, eyebrow, big headline, intro and actions. */
export function PageIntro({
  crumbs,
  eyebrow,
  icon: Icon,
  title,
  highlight,
  description,
  actions,
  aside,
  center = false,
}: {
  crumbs?: Array<{ href?: string; label: string }>;
  eyebrow?: string;
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  highlight?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  aside?: React.ReactNode;
  center?: boolean;
}) {
  return (
    <section className="relative isolate overflow-hidden pt-28 pb-16 sm:pt-36 sm:pb-24">
      <Aurora intensity={1.15} />
      <div aria-hidden className="bg-grid absolute inset-0 -z-10 opacity-50 [mask-image:radial-gradient(ellipse_60%_60%_at_50%_20%,black,transparent)]" />
      <div className={cn("mx-auto grid max-w-6xl gap-14 px-4 sm:px-6", aside ? "items-center lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]" : "")}>
        <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08 } } }} className={cn(center && !aside && "mx-auto max-w-3xl text-center")}>
          {crumbs?.length ? (
            <motion.nav variants={rise} aria-label="Breadcrumb" className={cn("mb-5 flex flex-wrap items-center gap-1 text-[12.5px] text-foreground-muted", center && !aside && "justify-center")}>
              {crumbs.map((crumb, index) => (
                <span key={crumb.label} className="inline-flex items-center gap-1">
                  {index > 0 ? <ChevronRight className="size-3.5 text-foreground-subtle" /> : null}
                  {crumb.href ? (
                    <Link href={crumb.href} className="transition-colors hover:text-foreground">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="text-foreground-secondary">
                      {crumb.label}
                    </span>
                  )}
                </span>
              ))}
            </motion.nav>
          ) : null}
          {eyebrow ? (
            <motion.p variants={rise} className={cn("inline-flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-brand-1 uppercase")}>
              {Icon ? (
                <span className="border-gradient flex size-7 items-center justify-center rounded-lg bg-surface/80">
                  <Icon className="size-3.5" />
                </span>
              ) : null}
              {eyebrow}
            </motion.p>
          ) : null}
          <motion.h1 variants={rise} className="mt-4 text-[40px] leading-[1.04] font-semibold tracking-[-0.04em] text-balance sm:text-[54px]">
            <Highlighted title={title} highlight={highlight} animate />
          </motion.h1>
          {description ? (
            <motion.p variants={rise} className={cn("mt-5 max-w-xl text-[16px] leading-relaxed text-foreground-secondary", center && !aside && "mx-auto")}>
              {description}
            </motion.p>
          ) : null}
          {actions ? (
            <motion.div variants={rise} className={cn("mt-8 flex flex-wrap items-center gap-3", center && !aside && "justify-center")}>
              {actions}
            </motion.div>
          ) : null}
        </motion.div>
        {aside ? (
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.8, ease: EASE_OUT }}>
            {aside}
          </motion.div>
        ) : null}
      </div>
    </section>
  );
}

export function PrimaryActions({ secondary = { href: "/product", label: "See how it works" } }: { secondary?: { href: string; label: string } | null }) {
  return (
    <>
      <Button asChild variant="primary" size="lg" className="relative overflow-hidden px-5 shadow-[var(--brand-glow)]">
        <Link href="/signup">
          Start free <ArrowRight />
          <span aria-hidden className="absolute inset-y-0 left-0 w-10 bg-white/25 blur-md" style={{ animation: "sheen 3.2s ease-in-out infinite" }} />
        </Link>
      </Button>
      {secondary ? (
        <Button asChild variant="secondary" size="lg" className="px-5">
          <Link href={secondary.href}>{secondary.label}</Link>
        </Button>
      ) : null}
    </>
  );
}

export function FaqList({ items, defaultOpen = 0 }: { items: Array<{ q: string; a: string }>; defaultOpen?: number | null }) {
  const [open, setOpen] = React.useState<number | null>(defaultOpen);
  return (
    <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
      {items.map((item, index) => {
        const isOpen = open === index;
        const id = `faq-${index}-${item.q.length}`;
        return (
          <li key={item.q}>
            <button type="button" className="flex w-full items-center gap-4 px-5 py-4 text-left" aria-expanded={isOpen} aria-controls={id} onClick={() => setOpen(isOpen ? null : index)}>
              <span className="flex-1 text-[14.5px] font-medium">{item.q}</span>
              <motion.span animate={{ rotate: isOpen ? 45 : 0 }} transition={{ duration: 0.2 }} className="text-foreground-muted">
                <Plus className="size-4" />
              </motion.span>
            </button>
            <AnimatePresence initial={false}>
              {isOpen ? (
                <motion.div id={id} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE_OUT }} className="overflow-hidden">
                  <p className="px-5 pb-5 text-[14px] leading-relaxed text-foreground-secondary">{item.a}</p>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </li>
        );
      })}
    </ul>
  );
}

export function FaqSection({ items, title = "Questions, answered", description }: { items: Array<{ q: string; a: string }>; title?: string; description?: React.ReactNode }) {
  return (
    <section id="faq" className="scroll-mt-24 py-24 sm:py-28">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <SectionHeading eyebrow="FAQ" title={title} highlight={title.includes("answered") ? "answered" : undefined} center={false} description={description} />
        <Reveal>
          <FaqList items={items} />
        </Reveal>
      </div>
    </section>
  );
}

export function CtaBand({ title = "Your next customers are already out there.", highlight = "Go meet them.", description = "Set up in minutes. Start on the free plan and keep every lead you find." }: { title?: string; highlight?: string; description?: string }) {
  return (
    <section className="px-4 pb-24 sm:px-6">
      <Reveal className="relative isolate mx-auto max-w-6xl overflow-hidden rounded-3xl border border-border bg-surface px-6 py-16 text-center shadow-lg sm:py-20">
        <Aurora intensity={1.4} />
        <div aria-hidden className="bg-grid absolute inset-0 -z-10 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
        <h2 className="mx-auto max-w-2xl text-[32px] leading-[1.1] font-semibold tracking-[-0.03em] text-balance sm:text-[44px]">
          {title} <span className="text-gradient animate-gradient-pan">{highlight}</span>
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-[15px] text-foreground-secondary">{description}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <PrimaryActions secondary={{ href: "/contact", label: "Talk to us" }} />
        </div>
      </Reveal>
    </section>
  );
}

/** A browser-style frame for product illustrations, labelled as example data. */
export function DemoFrame({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-border bg-surface/90 shadow-lg backdrop-blur-xl", className)}>
      <div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-[#ff5f57]" />
        <span className="size-2.5 rounded-full bg-[#febc2e]" />
        <span className="size-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-3 truncate text-[11.5px] font-medium text-foreground-muted">{title}</span>
        <span className="ml-auto shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-medium text-foreground-muted">Example data</span>
      </div>
      {children}
    </div>
  );
}
