"use client";

import * as React from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { Mail, Monitor, Moon, Sun } from "lucide-react";
import { motion } from "motion/react";
import { brand } from "@repo/config";
import { cn } from "@repo/ui";
import { Logo } from "../brand/logo";
import { COMPANY_LINKS, LEGAL_LINKS, PRODUCTS, USE_CASES } from "./site";

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

const subscribe = () => () => {};

function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  // The stored theme is only known in the browser; render a neutral state on the server.
  const mounted = React.useSyncExternalStore(subscribe, () => true, () => false);
  const current = mounted ? (theme ?? "system") : null;
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-full border border-border bg-surface p-0.5">
      {THEMES.map((option) => (
        <button key={option.value} type="button" role="radio" aria-checked={current === option.value} aria-label={option.label} title={option.label} onClick={() => setTheme(option.value)} className={cn("relative flex size-7 items-center justify-center rounded-full transition-colors", current === option.value ? "text-foreground" : "text-foreground-muted hover:text-foreground")}>
          {current === option.value ? <motion.span layoutId="footer-theme" className="absolute inset-0 rounded-full bg-surface-muted" transition={{ type: "spring", stiffness: 500, damping: 36 }} /> : null}
          <option.icon className="relative size-3.5" />
        </button>
      ))}
    </div>
  );
}

const COLUMNS = [
  { title: "Product", links: [{ href: "/product", label: "Platform overview" }, ...PRODUCTS.map((product) => ({ href: `/product/${product.slug}`, label: product.name })), { href: "/pricing", label: "Pricing" }] },
  { title: "Use cases", links: USE_CASES.map((item) => ({ href: `/use-cases/${item.slug}`, label: item.name })) },
  { title: "Company", links: [...COMPANY_LINKS.map((link) => ({ href: link.href, label: link.label })), { href: "/login", label: "Live demo" }] },
];

export function Footer() {
  return (
    <footer className="relative isolate overflow-hidden border-t border-border bg-surface/50">
      <div aria-hidden className="bg-brand-gradient absolute -bottom-40 left-1/2 -z-10 h-64 w-[70%] -translate-x-1/2 rounded-full opacity-10 blur-3xl" />
      <div className="mx-auto grid max-w-6xl gap-12 px-4 pt-16 pb-10 sm:px-6 lg:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))]">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-[13.5px] leading-relaxed text-foreground-secondary">{brand.description}</p>
          <a href={`mailto:${brand.supportEmail}`} className="mt-5 inline-flex items-center gap-2 text-[13px] font-medium text-foreground-secondary transition-colors hover:text-foreground">
            <Mail className="size-4" /> {brand.supportEmail}
          </a>
        </div>
        {COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <p className="text-[12px] font-semibold tracking-wide text-foreground-muted uppercase">{column.title}</p>
            <ul className="mt-4 grid gap-2.5">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-[13.5px] text-foreground-secondary transition-colors hover:text-foreground">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="mx-auto flex max-w-6xl flex-col gap-4 border-t border-border px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-[12.5px] text-foreground-muted">
          © {new Date().getFullYear()} {brand.legalName}
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          {LEGAL_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="text-[12.5px] text-foreground-muted transition-colors hover:text-foreground">
              {link.label}
            </Link>
          ))}
          <ThemeSwitcher />
        </div>
      </div>
    </footer>
  );
}
