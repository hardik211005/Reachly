"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Button, cn } from "@repo/ui";
import { Logo } from "../brand/logo";

const LINKS = [
  { href: "#features", label: "Product" },
  { href: "#how", label: "How it works" },
  { href: "#trust", label: "Trust" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

export function MarketingNav() {
  const [scrolled, setScrolled] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header className={cn("fixed inset-x-0 top-0 z-50 transition-[background,border-color,backdrop-filter] duration-300", scrolled || open ? "border-b border-border bg-background/75 backdrop-blur-xl" : "border-b border-transparent")}>
      <nav className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6" aria-label="Main">
        <Link href="/" className="shrink-0" aria-label="Home">
          <Logo />
        </Link>
        <ul className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <li key={link.href}>
              <a href={link.href} className="rounded-md px-3 py-1.5 text-[13px] font-medium text-foreground-secondary transition-colors hover:bg-surface-muted hover:text-foreground">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild variant="primary" size="sm" className="relative overflow-hidden">
            <Link href="/signup">
              Start free
              <span aria-hidden className="absolute inset-y-0 left-0 w-8 bg-white/25 blur-md" style={{ animation: "sheen 3.2s ease-in-out infinite" }} />
            </Link>
          </Button>
        </div>
        <button type="button" className="ml-auto rounded-md p-2 text-foreground-secondary md:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </nav>
      <AnimatePresence>
        {open ? (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden md:hidden">
            <ul className="grid gap-1 px-4 pb-4">
              {LINKS.map((link) => (
                <li key={link.href}>
                  <a href={link.href} onClick={() => setOpen(false)} className="block rounded-md px-3 py-2 text-sm font-medium text-foreground-secondary hover:bg-surface-muted">
                    {link.label}
                  </a>
                </li>
              ))}
              <li className="mt-2 grid grid-cols-2 gap-2">
                <Button asChild variant="secondary">
                  <Link href="/login">Sign in</Link>
                </Button>
                <Button asChild variant="primary">
                  <Link href="/signup">Start free</Link>
                </Button>
              </li>
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
