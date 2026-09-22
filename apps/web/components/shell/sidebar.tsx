"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronsUpDown, LogOut, Moon, PanelLeftClose, PanelLeftOpen, Plus, Sun, UserRound } from "lucide-react";
import { useTheme } from "next-themes";
import { useQuery } from "@tanstack/react-query";
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  cn,
  toast,
} from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { authClient } from "@/lib/auth-client";
import { Logo } from "../brand/logo";
import { NAV_FOOTER, NAV_GROUPS, isActive, type NavItem } from "./nav";
import { useCanManage, useShell } from "./shell-context";

/** Attention counts shown next to nav items: replies needing a response, drafts awaiting review, calls, tasks due. */
function useNavCounts(): Record<string, number> {
  const summary = useQuery({
    queryKey: ["inbox-summary"],
    queryFn: () => api<{ needsResponse: number; unread: number; pendingApproval: number; callsWaiting: number; tasksDue: number }>("/api/v1/conversations/summary"),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  return {
    "/app/conversations": summary.data?.needsResponse ?? 0,
    "/app/campaigns": summary.data?.pendingApproval ?? 0,
    "/app/calls": summary.data?.callsWaiting ?? 0,
    "/app/crm": summary.data?.tasksDue ?? 0,
  };
}

function NavLink({ item, collapsed, onNavigate, count = 0 }: { item: NavItem; collapsed: boolean; onNavigate?: () => void; count?: number }) {
  const pathname = usePathname();
  const active = isActive(pathname, item.href);
  const label = count ? `${item.label} (${count})` : item.label;
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium transition-colors",
        active ? "bg-surface-muted text-foreground" : "text-foreground-secondary hover:bg-surface-muted/70 hover:text-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      <span className="relative">
        <item.icon className={cn("size-4 shrink-0", active ? "text-foreground" : "text-foreground-muted group-hover:text-foreground-secondary")} />
        {collapsed && count ? <span aria-hidden className="absolute -top-1 -right-1 size-2 rounded-full bg-accent ring-2 ring-background" /> : null}
      </span>
      {collapsed ? <span className="sr-only">{label}</span> : <span className="truncate">{item.label}</span>}
      {!collapsed && count ? (
        <span className="ml-auto rounded-full bg-accent-soft px-1.5 text-[10.5px] leading-[18px] font-semibold text-accent-soft-foreground tabular" aria-label={`${count} need attention`}>
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
  return collapsed ? (
    <Tooltip content={label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const { workspace, workspaces, plan } = useShell();
  const router = useRouter();

  async function switchTo(id: string) {
    try {
      await api("/api/v1/workspaces/switch", { method: "POST", json: { organizationId: id } });
      router.push("/app");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-10 w-full items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-surface-muted",
            collapsed && "justify-center",
          )}
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-foreground text-[11px] font-semibold text-background">
            {workspace.name.slice(0, 1).toUpperCase()}
          </span>
          {collapsed ? null : (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{workspace.name}</span>
                <span className="block truncate text-[11px] text-foreground-muted">{plan.name} plan</span>
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-foreground-muted" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {workspaces.map((item) => (
          <DropdownMenuItem key={item.id} onSelect={() => item.id !== workspace.id && switchTo(item.id)}>
            <span className="flex size-5 items-center justify-center rounded-sm bg-surface-sunken text-[10px] font-semibold">
              {item.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="flex-1 truncate">{item.name}</span>
            {item.id === workspace.id ? <Check className="!text-foreground" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/onboarding?new=1")}>
          <Plus /> New workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({ collapsed }: { collapsed: boolean }) {
  const { user } = useShell();
  const { resolvedTheme, setTheme } = useTheme();
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn("flex h-10 w-full items-center gap-2 rounded-md px-1.5 text-left hover:bg-surface-muted", collapsed && "justify-center")}
        >
          <Avatar name={user.name} src={user.image} size="sm" />
          {collapsed ? null : (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{user.name}</span>
              <span className="block truncate text-[11px] text-foreground-muted">{user.email}</span>
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuItem onSelect={() => router.push("/app/settings/profile")}>
          <UserRound /> Profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
          {resolvedTheme === "dark" ? <Sun /> : <Moon />} {resolvedTheme === "dark" ? "Light" : "Dark"} theme
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await authClient.signOut();
            router.push("/login");
            router.refresh();
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SidebarContent({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const canManage = useCanManage();
  const counts = useNavCounts();
  return (
    <div className="flex h-full flex-col">
      <div className="px-2 pt-2">
        <WorkspaceSwitcher collapsed={collapsed} />
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 pt-3 pb-2">
        {NAV_GROUPS.map((group, index) => (
          <div key={group.label ?? index} className={cn(index > 0 && "mt-4")}>
            {group.label && !collapsed ? (
              <p className="mb-1 px-2 text-[11px] font-medium text-foreground-subtle">{group.label}</p>
            ) : null}
            {group.label && collapsed ? <div className="mx-2 mb-2 h-px bg-border" /> : null}
            <div className="grid gap-0.5">
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} collapsed={collapsed} onNavigate={onNavigate} count={counts[item.href]} />
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="grid gap-0.5 border-t border-border px-2 py-2">
        {NAV_FOOTER.filter((item) => !item.adminOnly || canManage).map((item) => (
          <NavLink key={item.href} item={item} collapsed={collapsed} onNavigate={onNavigate} />
        ))}
      </div>
      <div className="border-t border-border px-2 py-2">
        <UserMenu collapsed={collapsed} />
      </div>
    </div>
  );
}

const COLLAPSE_KEY = "sidebar-collapsed";
const collapseListeners = new Set<() => void>();

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribeCollapsed(listener: () => void) {
  collapseListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    collapseListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Per-viewer preference persisted in localStorage; server render assumes expanded. */
function useCollapsed(): [boolean, () => void] {
  const collapsed = React.useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const toggle = React.useCallback(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, readCollapsed() ? "0" : "1");
    } catch {
      /* storage unavailable: preference just isn't remembered */
    }
    collapseListeners.forEach((listener) => listener());
  }, []);
  return [collapsed, toggle];
}

export function Sidebar() {
  const [collapsed, toggle] = useCollapsed();

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 md:flex",
        collapsed ? "w-[56px]" : "w-[232px]",
      )}
    >
      <div className={cn("flex h-11 items-center border-b border-border px-3", collapsed ? "justify-center" : "justify-between")}>
        {collapsed ? null : (
          <Link href="/app" aria-label="Home">
            <Logo />
          </Link>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="rounded-sm p-1 text-foreground-muted hover:bg-surface-muted hover:text-foreground"
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>
      <SidebarContent collapsed={collapsed} />
    </aside>
  );
}
