"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FlaskConical, Menu, MessageSquareText, Search } from "lucide-react";
import { Button, Kbd, Sheet, SheetContent, SheetTitle, Tooltip } from "@repo/ui";
import { Logo } from "../brand/logo";
import { ThemeToggle } from "../theme-toggle";
import { CommandMenu } from "./command-menu";
import { ALL_NAV_ITEMS } from "./nav";
import { NotificationsButton } from "./notifications";
import { ShellProvider, type ShellData } from "./shell-context";
import { Sidebar, SidebarContent } from "./sidebar";
import { CopilotPanel } from "../copilot/copilot-panel";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** Global shortcuts: ⌘K / Ctrl+K opens the command menu; "g" then a letter navigates. */
function useGlobalShortcuts(onCommand: () => void, onCopilot: () => void) {
  const router = useRouter();
  React.useEffect(() => {
    let pendingG = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onCommand();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        onCopilot();
        return;
      }
      if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (pendingG) {
        pendingG = false;
        clearTimeout(timer);
        const item = ALL_NAV_ITEMS.find((nav) => nav.shortcut === event.key.toLowerCase());
        if (item) {
          event.preventDefault();
          router.push(item.href);
        }
        return;
      }
      if (event.key === "g") {
        pendingG = true;
        timer = setTimeout(() => (pendingG = false), 800);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, onCommand, onCopilot]);
}

function DemoModeBadge({ mockProviders }: { mockProviders: string[] }) {
  return (
    <Tooltip
      content={
        mockProviders.length
          ? `Demo mode: ${mockProviders.join(", ")} use mock providers. Messages and calls are simulated, not sent.`
          : "Demo mode is on."
      }
    >
      <Link
        href="/app/integrations"
        className="inline-flex h-6 items-center gap-1.5 rounded-full border border-warning/50 bg-warning-soft px-2 text-[11px] font-medium text-warning-text"
      >
        <FlaskConical className="size-3" /> Demo mode
      </Link>
    </Tooltip>
  );
}

export function AppShell({ data, children }: { data: ShellData; children: React.ReactNode }) {
  const [commandOpen, setCommandOpen] = React.useState(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [copilotOpen, setCopilotOpen] = React.useState(false);
  const openCommand = React.useCallback(() => setCommandOpen(true), []);
  const toggleCopilot = React.useCallback(() => setCopilotOpen((value) => !value), []);
  useGlobalShortcuts(openCommand, toggleCopilot);

  return (
    <ShellProvider value={data}>
      <div className="flex min-h-dvh">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-[72px] items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-5">
            <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}>
              <Menu />
            </Button>
            <Link href="/app" className="md:hidden">
              <Logo showName={false} />
            </Link>
            <button
              type="button"
              onClick={openCommand}
              className="flex h-9 w-full max-w-md items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] text-foreground-subtle shadow-xs transition-colors hover:border-border-strong"
            >
              <Search className="size-3.5" />
              <span className="flex-1 truncate text-left">Search or jump to…</span>
              <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
            </button>
            <div className="ml-auto flex items-center gap-1.5">
              {data.demoMode ? <DemoModeBadge mockProviders={data.mockProviders} /> : null}
              <Tooltip content="Ask Copilot (⌘J)">
                <Button variant="ghost" size="icon" aria-label="Open copilot" onClick={toggleCopilot}>
                  <MessageSquareText />
                </Button>
              </Tooltip>
              <ThemeToggle />
              <NotificationsButton />
            </div>
          </header>
          <main className="flex-1">{children}</main>
        </div>
      </div>
      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
      <CopilotPanel open={copilotOpen} onOpenChange={setCopilotOpen} />
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent collapsed={false} onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>
    </ShellProvider>
  );
}

