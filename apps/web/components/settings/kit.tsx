"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, CreditCard, KeyRound, Plug, ShieldCheck, SlidersHorizontal, Store, UserRound, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Button, EASE_OUT, Reveal, Spinner, cn } from "@repo/ui";

export const SETTINGS_NAV = [
  { href: "/app/settings", label: "General", description: "Workspace name, time zone and currency", icon: SlidersHorizontal },
  { href: "/app/settings/profile", label: "Your profile", description: "Name, password and sessions", icon: UserRound },
  { href: "/app/settings/business", label: "Business & services", description: "What you sell and who to", icon: Store },
  { href: "/app/settings/team", label: "Team", description: "Members, roles and invitations", icon: Users },
  { href: "/app/settings/compliance", label: "Compliance", description: "Sending rules, calling and opt-outs", icon: ShieldCheck },
  { href: "/app/settings/api-keys", label: "API keys", description: "Programmatic access", icon: KeyRound },
];

const ELSEWHERE = [
  { href: "/app/integrations", label: "Integrations", icon: Plug },
  { href: "/app/billing", label: "Billing & plan", icon: CreditCard },
];

export function SettingsNav() {
  const pathname = usePathname();
  const active = SETTINGS_NAV.slice()
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))?.href;
  return (
    <nav aria-label="Settings" className="min-w-0 lg:sticky lg:top-20">
      <ul className="flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none] lg:grid lg:overflow-visible">
        {SETTINGS_NAV.map((item) => {
          const isActive = active === item.href;
          return (
            <li key={item.href} className="shrink-0">
              <Link href={item.href} aria-current={isActive ? "page" : undefined} className={cn("relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium whitespace-nowrap transition-colors", isActive ? "text-foreground" : "text-foreground-secondary hover:bg-surface-muted/70 hover:text-foreground")}>
                {isActive ? <motion.span layoutId="settings-nav" className="absolute inset-0 rounded-lg border border-border bg-surface shadow-xs" transition={{ type: "spring", stiffness: 500, damping: 38 }} /> : null}
                <item.icon className={cn("relative size-4", isActive ? "text-brand-1" : "text-foreground-muted")} />
                <span className="relative">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-6 hidden border-t border-border pt-4 lg:block">
        <p className="px-3 text-[11px] font-semibold tracking-wide text-foreground-subtle uppercase">Also</p>
        <ul className="mt-2 grid gap-0.5">
          {ELSEWHERE.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-foreground-secondary transition-colors hover:bg-surface-muted/70 hover:text-foreground">
                <item.icon className="size-4 text-foreground-muted" /> {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

/** A titled card for one group of settings. */
export function Section({ title, description, icon: Icon, children, footer, tone = "default", className, id }: { title: string; description?: React.ReactNode; icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode; footer?: React.ReactNode; tone?: "default" | "danger"; className?: string; id?: string }) {
  return (
    <Reveal y={12} id={id} className={cn("scroll-mt-24 overflow-hidden rounded-xl border bg-surface shadow-xs", tone === "danger" ? "border-critical/30" : "border-border", className)}>
      <header className="flex items-start gap-3 border-b border-border px-5 py-4">
        {Icon ? (
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", tone === "danger" ? "bg-danger-soft text-danger-text" : "bg-accent-soft text-accent-soft-foreground")}>
            <Icon className="size-4" />
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-[14.5px] font-semibold">{title}</h2>
          {description ? <p className="mt-0.5 text-[12.5px] leading-relaxed text-foreground-muted">{description}</p> : null}
        </div>
      </header>
      <div className="px-5 py-5">{children}</div>
      {footer ? <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-muted/40 px-5 py-3">{footer}</footer> : null}
    </Reveal>
  );
}

/** Save / discard controls that appear when a form has unsaved changes. */
export function SaveBar({ dirty, pending, onSave, onReset, disabled, label = "Save changes" }: { dirty: boolean; pending: boolean; onSave: () => void; onReset: () => void; disabled?: boolean; label?: string }) {
  return (
    <>
      <AnimatePresence initial={false}>
        {dirty ? (
          <motion.span initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} transition={{ duration: 0.2, ease: EASE_OUT }} className="mr-auto inline-flex items-center gap-1.5 text-[12px] text-warning-text">
            <span className="size-1.5 rounded-full bg-warning" /> Unsaved changes
          </motion.span>
        ) : null}
      </AnimatePresence>
      <Button variant="ghost" size="sm" onClick={onReset} disabled={!dirty || pending}>
        Discard
      </Button>
      <Button variant="primary" size="sm" onClick={onSave} disabled={!dirty || pending || disabled}>
        {pending ? <Spinner className="size-3.5" /> : null}
        {label}
      </Button>
    </>
  );
}

/** Label + control on one row, stacking on small screens. */
export function Row({ label, hint, children, htmlFor }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="grid gap-2 border-b border-border py-4 first:pt-0 last:border-0 last:pb-0 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] sm:gap-6">
      <div>
        <label htmlFor={htmlFor} className="text-[13px] font-medium">
          {label}
        </label>
        {hint ? <p className="mt-0.5 text-[12px] leading-relaxed text-foreground-muted">{hint}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function ReadOnlyNotice({ what = "these settings" }: { what?: string }) {
  return (
    <p className="mb-4 flex items-center gap-2 rounded-lg bg-surface-muted px-3 py-2 text-[12.5px] text-foreground-secondary">
      <Building2 className="size-3.5 text-foreground-muted" /> Only workspace admins can change {what}.
    </p>
  );
}
