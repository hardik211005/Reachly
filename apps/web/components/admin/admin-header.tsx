"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, ShieldHalf } from "lucide-react";
import { Badge, Button, cn } from "@repo/ui";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { authClient } from "@/lib/auth-client";

/** Top bar of the admin portal: separate from the business app, with its own sign-out. */
const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/system", label: "Server health" },
];

export function AdminHeader({ viewer }: { viewer: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/80 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/admin" className="flex items-center gap-3">
          <Logo />
          <Badge tone="danger">
            <ShieldHalf className="size-3" /> Admin
          </Badge>
        </Link>
        <nav aria-label="Admin" className="mr-auto ml-2 flex items-center gap-1">
          {LINKS.map((link) => {
            const active =
              link.href === "/admin"
                ? pathname === "/admin" || pathname.startsWith("/admin/workspaces")
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                  active
                    ? "bg-surface-muted text-foreground"
                    : "text-foreground-secondary hover:text-foreground",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-1.5">
          <span className="mr-1 hidden text-[12px] text-foreground-muted md:inline">{viewer}</span>
          <ThemeToggle />
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              await authClient.signOut();
              router.push("/admin/login");
              router.refresh();
            }}
          >
            <LogOut /> Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}

/** Signs out and stays on the admin sign-in (used when a business account lands there). */
export function AdminSignOutButton() {
  const router = useRouter();
  return (
    <Button
      variant="primary"
      className="w-full"
      onClick={async () => {
        await authClient.signOut();
        router.refresh();
      }}
    >
      <LogOut /> Sign out and use an admin account
    </Button>
  );
}
