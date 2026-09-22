"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, ChevronDown, Menu, PlayCircle, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { brand } from "@repo/config";
import { Button, EASE_OUT, cn } from "@repo/ui";
import { Logo } from "../brand/logo";
import { ThemeToggle } from "../theme-toggle";
import { SearchButton } from "./site-search";
import { COMPANY_LINKS, PRODUCTS, USE_CASES } from "./site";

type MenuKey = "product" | "use-cases" | "company";

const TOP: Array<{ key: MenuKey; label: string; match: string } | { href: string; label: string; match: string }> = [
  { href: "/", label: "Home", match: "=/" },
  { key: "product", label: "Services", match: "=/product|/product/ai-outreach|/product/ai-calling|/product/workflows|/product/crm-quotes|/product/analytics" },
  { href: "/product/lead-discovery", label: "Find leads", match: "=/product/lead-discovery" },
  { href: "/pricing", label: "Plans", match: "/pricing" },
  { key: "use-cases", label: "Use cases", match: "/use-cases" },
  { key: "company", label: "Company", match: "/about|/security|/contact" },
];

/** "=path" matches exactly; other entries match the path and anything under it. */
function isActive(pathname: string, match: string) {
  return match.split("|").some((prefix) => (prefix.startsWith("=") ? pathname === prefix.slice(1) : pathname === prefix || pathname.startsWith(`${prefix}/`)));
}

function MenuLink({ href, icon: Icon, title, description, onNavigate }: { href: string; icon: React.ComponentType<{ className?: string }>; title: string; description: string; onNavigate: () => void }) {
  return (
    <Link href={href} onClick={onNavigate} className="group flex gap-3 rounded-xl p-2.5 transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface shadow-xs transition-transform duration-200 group-hover:scale-105 group-hover:border-transparent group-hover:shadow-[var(--brand-glow)]">
        <Icon className="size-4 text-brand-1" />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-[13.5px] font-semibold">
          {title}
          <ArrowRight className="size-3 -translate-x-1 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100" />
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-foreground-muted">{description}</span>
      </span>
    </Link>
  );
}

function ProductMenu({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="grid w-[760px] grid-cols-[minmax(0,1fr)_220px] gap-2 p-2">
      <div className="grid grid-cols-2 gap-1">
        {PRODUCTS.map((product) => (
          <MenuLink key={product.slug} href={`/product/${product.slug}`} icon={product.icon} title={product.name} description={product.summary} onNavigate={onNavigate} />
        ))}
      </div>
      <div className="grid gap-2">
        <Link href="/product" onClick={onNavigate} className="group relative isolate overflow-hidden rounded-xl border border-border bg-surface-muted/60 p-4">
          <span aria-hidden className="bg-brand-gradient absolute -top-10 -right-10 -z-10 size-28 rounded-full opacity-25 blur-2xl transition-opacity group-hover:opacity-40" />
          <Sparkles className="size-4 text-brand-2" />
          <p className="mt-3 text-[13.5px] font-semibold">Platform overview</p>
          <p className="mt-1 text-[12px] leading-snug text-foreground-muted">How discovery, outreach, calls and the CRM work together.</p>
          <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-brand-1">
            Explore <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
        <Link href="/pricing" onClick={onNavigate} className="group rounded-xl border border-border p-4 transition-colors hover:bg-surface-muted">
          <PlayCircle className="size-4 text-foreground-secondary" />
          <p className="mt-3 text-[13.5px] font-semibold">Start free</p>
          <p className="mt-1 text-[12px] leading-snug text-foreground-muted">Find real leads today. See what each plan includes.</p>
        </Link>
      </div>
    </div>
  );
}

function UseCasesMenu({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="w-[560px] p-2">
      <div className="grid grid-cols-2 gap-1">
        {USE_CASES.map((item) => (
          <MenuLink key={item.slug} href={`/use-cases/${item.slug}`} icon={item.icon} title={item.name} description={item.summary} onNavigate={onNavigate} />
        ))}
      </div>
      <Link href="/use-cases" onClick={onNavigate} className="mt-1 flex items-center justify-between rounded-xl bg-surface-muted/60 px-4 py-3 text-[12.5px] font-medium text-foreground-secondary transition-colors hover:text-foreground">
        See how each team uses {brand.name}
        <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}

function CompanyMenu({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="grid w-[320px] gap-1 p-2">
      {COMPANY_LINKS.map((link) => (
        <MenuLink key={link.href} href={link.href} icon={link.icon} title={link.label} description={link.description} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

const MENUS: Record<MenuKey, React.ComponentType<{ onNavigate: () => void }>> = { product: ProductMenu, "use-cases": UseCasesMenu, company: CompanyMenu };

export function MarketingNav() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = React.useState(false);
  const [menu, setMenu] = React.useState<MenuKey | null>(null);
  const [hovered, setHovered] = React.useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const closeTimer = React.useRef<number | undefined>(undefined);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  React.useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setMenu(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  React.useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const openMenu = (key: MenuKey) => {
    window.clearTimeout(closeTimer.current);
    setMenu(key);
  };
  const scheduleClose = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setMenu(null), 140);
  };
  const close = () => {
    setMenu(null);
    setMobileOpen(false);
  };
  const Panel = menu ? MENUS[menu] : null;

  return (
    <header className={cn("fixed inset-x-0 top-0 z-50 transition-[background,border-color,box-shadow] duration-300", scrolled || mobileOpen || menu ? "border-b border-border bg-background/80 shadow-[0_1px_0_rgba(0,0,0,0.02)] backdrop-blur-xl" : "border-b border-transparent")}>
      <nav className="mx-auto flex h-[72px] max-w-7xl items-center gap-4 px-4 sm:px-6" aria-label="Main">
        <Link href="/" className="shrink-0" aria-label={`${brand.name} home`} onClick={close}>
          <Logo size="lg" />
        </Link>
        <ul className="ml-6 hidden items-center lg:flex" onMouseLeave={() => { setHovered(null); scheduleClose(); }}>
          {TOP.map((item) => {
            const active = isActive(pathname, item.match);
            const id = "key" in item ? item.key : item.href;
            const highlight = hovered === id ? <motion.span layoutId="nav-hover" className="absolute inset-0 rounded-md bg-surface-muted" transition={{ type: "spring", stiffness: 500, damping: 38 }} /> : null;
            const labelClass = cn("relative inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[13.5px] font-medium transition-colors", active || (("key" in item) && menu === item.key) ? "text-foreground" : "text-foreground-secondary hover:text-foreground");
            return (
              <li key={id} className="relative" onMouseEnter={() => { setHovered(id); if ("key" in item) openMenu(item.key); else scheduleClose(); }}>
                {"key" in item ? (
                  <button type="button" className={labelClass} aria-expanded={menu === item.key} aria-haspopup="true" onClick={() => setMenu(menu === item.key ? null : item.key)}>
                    {highlight}
                    <span className="relative">{item.label}</span>
                    <ChevronDown className={cn("relative size-3.5 transition-transform duration-200", menu === item.key && "rotate-180")} />
                    {active ? <span className="bg-brand-gradient absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full" /> : null}
                  </button>
                ) : (
                  <Link href={item.href} className={labelClass} aria-current={active ? "page" : undefined} onClick={close}>
                    {highlight}
                    <span className="relative">{item.label}</span>
                    {active ? <span className="bg-brand-gradient absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full" /> : null}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
        <div className="ml-auto hidden items-center gap-2 lg:flex">
          <SearchButton compact className="xl:hidden" />
          <SearchButton className="hidden w-40 xl:inline-flex" />
          <ThemeToggle />
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
        <div className="ml-auto flex items-center gap-1.5 lg:hidden">
          <SearchButton compact />
          <ThemeToggle />
          <button type="button" className="rounded-md p-2 text-foreground-secondary" aria-label={mobileOpen ? "Close menu" : "Open menu"} aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </nav>

      {/* Desktop dropdown panel */}
      <AnimatePresence>
        {Panel ? (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            onMouseEnter={() => window.clearTimeout(closeTimer.current)}
            onMouseLeave={scheduleClose}
            className="absolute top-[66px] left-1/2 hidden -translate-x-1/2 lg:block"
          >
            <div className="overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-lg">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={menu} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }}>
                  <Panel onNavigate={close} />
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen ? (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "calc(100dvh - 72px)" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease: EASE_OUT }} className="overflow-y-auto border-t border-border bg-background lg:hidden">
            <MobileMenu onNavigate={close} pathname={pathname} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}

function MobileSection({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="border-b border-border">
      <button type="button" className="flex w-full items-center justify-between py-3.5 text-[15px] font-semibold" aria-expanded={open} onClick={() => setOpen(!open)}>
        {title}
        <ChevronDown className={cn("size-4 text-foreground-muted transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: EASE_OUT }} className="overflow-hidden">
            <div className="grid gap-0.5 pb-3">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function MobileMenu({ onNavigate, pathname }: { onNavigate: () => void; pathname: string }) {
  const item = (href: string, label: string, Icon?: React.ComponentType<{ className?: string }>) => (
    <Link key={href} href={href} onClick={onNavigate} aria-current={pathname === href ? "page" : undefined} className="flex items-center gap-3 rounded-lg px-2 py-2 text-[14px] text-foreground-secondary hover:bg-surface-muted aria-[current=page]:font-semibold aria-[current=page]:text-foreground">
      {Icon ? <Icon className="size-4 text-brand-1" /> : null}
      {label}
    </Link>
  );
  return (
    <div className="flex min-h-full flex-col px-4 pt-2 pb-6">
      <Link href="/" onClick={onNavigate} className="border-b border-border py-3.5 text-[15px] font-semibold">
        Home
      </Link>
      <Link href="/product/lead-discovery" onClick={onNavigate} className="border-b border-border py-3.5 text-[15px] font-semibold">
        Find leads
      </Link>
      <MobileSection title="Services" defaultOpen={pathname.startsWith("/product")}>
        {item("/product", "Platform overview", Sparkles)}
        {PRODUCTS.map((product) => item(`/product/${product.slug}`, product.name, product.icon))}
      </MobileSection>
      <MobileSection title="Use cases" defaultOpen={pathname.startsWith("/use-cases")}>
        {USE_CASES.map((useCase) => item(`/use-cases/${useCase.slug}`, useCase.name, useCase.icon))}
      </MobileSection>
      <Link href="/pricing" onClick={onNavigate} className="border-b border-border py-3.5 text-[15px] font-semibold">
        Plans
      </Link>
      <MobileSection title="Company">{COMPANY_LINKS.map((link) => item(link.href, link.label, link.icon))}</MobileSection>
      <div className="mt-auto grid grid-cols-2 gap-2 pt-6">
        <Button asChild variant="secondary">
          <Link href="/login" onClick={onNavigate}>
            Sign in
          </Link>
        </Button>
        <Button asChild variant="primary">
          <Link href="/signup" onClick={onNavigate}>
            Start free
          </Link>
        </Button>
      </div>
    </div>
  );
}
