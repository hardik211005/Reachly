"use client";

import * as React from "react";
import { Handshake, Mail, Radar, Sparkles, Telescope } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { brand } from "@repo/config";
import { Aurora, EASE_OUT, cn } from "@repo/ui";

const LOOP = [
  { step: "Describe", detail: "what you sell and who buys it", icon: Sparkles, preview: "Cafes and restaurants in South Delhi that take bookings" },
  { step: "Discover", detail: "businesses that match, with sources", icon: Telescope, preview: "Monsoon Cafe · Hauz Khas · found via Google Places" },
  { step: "Qualify", detail: "every lead scored with visible reasons", icon: Radar, preview: "Score 86 · industry fit, 4.6★ reviews, no booking widget" },
  { step: "Reach out", detail: "personalised email, WhatsApp and calls", icon: Mail, preview: "“Hi Priya — saw the new brunch menu. Quick idea for weekends…”" },
  { step: "Close", detail: "replies, meetings and quotes in one CRM", icon: Handshake, preview: "Quote accepted online · deal moved to Won" },
];

const STEP_MS = 2600;

/** Right-hand panel on the sign-in pages: the product loop, played one step at a time. */
export function AuthShowcase() {
  const reduce = useReducedMotion();
  const [active, setActive] = React.useState(0);
  React.useEffect(() => {
    if (reduce) return;
    const timer = window.setInterval(() => setActive((value) => (value + 1) % LOOP.length), STEP_MS);
    return () => window.clearInterval(timer);
  }, [reduce]);
  const current = LOOP[active]!;

  return (
    <aside className="relative isolate hidden overflow-hidden border-l border-border bg-surface lg:flex lg:flex-col lg:justify-center lg:px-14">
      <Aurora intensity={1.3} />
      <div aria-hidden className="bg-grid absolute inset-0 -z-10 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      <div className="relative max-w-md">
        <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE_OUT }} className="text-xs font-semibold tracking-[0.14em] text-brand-1 uppercase">
          How it works
        </motion.p>
        <motion.h2 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08, duration: 0.6, ease: EASE_OUT }} className="mt-3 text-[28px] leading-[1.15] font-semibold tracking-[-0.03em] text-balance">
          Stop searching maps and spreadsheets for <span className="text-gradient">customers.</span>
        </motion.h2>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.6 }} className="mt-3 text-[13.5px] leading-relaxed text-foreground-secondary">
          {brand.description}
        </motion.p>

        <ol className="mt-10">
          {LOOP.map((item, index) => {
            const isActive = index === active;
            const done = index < active;
            return (
              <li key={item.step} className="relative flex gap-4 pb-5 last:pb-0">
                {index < LOOP.length - 1 ? (
                  <span aria-hidden className="absolute top-8 bottom-0 left-[15px] w-px overflow-hidden bg-border">
                    <motion.span className="bg-brand-gradient absolute inset-x-0 top-0" initial={false} animate={{ height: done ? "100%" : "0%" }} transition={{ duration: 0.5, ease: EASE_OUT }} />
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setActive(index)}
                  aria-label={`Show step ${index + 1}: ${item.step}`}
                  className={cn(
                    "relative z-[1] flex size-8 shrink-0 items-center justify-center rounded-full border transition-[background,border-color,color,box-shadow] duration-300",
                    isActive ? "border-transparent bg-foreground text-background shadow-[var(--brand-glow)]" : done ? "border-brand-1/40 bg-surface text-brand-1" : "border-border bg-background text-foreground-muted",
                  )}
                >
                  <item.icon className="size-3.5" />
                  {isActive && !reduce ? <span aria-hidden className="absolute inset-0 animate-pulse-ring rounded-full" /> : null}
                </button>
                <div className="min-w-0 pt-1">
                  <p className={cn("text-[13.5px] font-medium transition-colors", isActive ? "text-foreground" : "text-foreground-secondary")}>{item.step}</p>
                  <p className="text-[13px] text-foreground-muted">{item.detail}</p>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="relative mt-8 h-[76px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={current.step}
              initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
              transition={{ duration: 0.35, ease: EASE_OUT }}
              className="border-gradient absolute inset-x-0 top-0 rounded-xl bg-surface/90 px-4 py-3 shadow-lg backdrop-blur-sm"
            >
              <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-foreground-muted uppercase">
                <current.icon className="size-3 text-brand-1" /> {current.step}
                <span className="ml-auto font-normal tracking-normal normal-case">Example</span>
              </p>
              <p className="mt-1 truncate text-[13px] text-foreground">{current.preview}</p>
              {!reduce ? (
                <motion.span aria-hidden className="bg-brand-gradient absolute bottom-0 left-4 h-0.5 rounded-full" initial={{ width: 0 }} animate={{ width: "calc(100% - 2rem)" }} transition={{ duration: STEP_MS / 1000, ease: "linear" }} />
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </aside>
  );
}
