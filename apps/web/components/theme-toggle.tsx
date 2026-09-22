"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Tooltip, cn } from "@repo/ui";

const subscribe = () => () => {};

/** Light/dark switch. The stored theme is only known in the browser, so the server renders a neutral icon. */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = React.useSyncExternalStore(subscribe, () => true, () => false);
  const dark = mounted && resolvedTheme === "dark";
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={() => setTheme(dark ? "light" : "dark")}
        aria-label={label}
        className={cn("relative flex size-9 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface/70 text-foreground-secondary transition-colors hover:border-border-strong hover:text-foreground", className)}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={dark ? "moon" : "sun"} initial={{ y: 12, rotate: -60, opacity: 0 }} animate={{ y: 0, rotate: 0, opacity: 1 }} exit={{ y: -12, rotate: 60, opacity: 0 }} transition={{ duration: 0.2 }} className="flex">
            {dark ? <Moon className="size-4" /> : <Sun className="size-4" />}
          </motion.span>
        </AnimatePresence>
      </button>
    </Tooltip>
  );
}
