"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, CalendarCheck, CheckCircle2, MapPin, PhoneCall, Search, Sparkles, Trophy } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { brand } from "@repo/config";
import { Aurora, Button, EASE_OUT, cn } from "@repo/ui";

const LEADS = [
  { name: "Monsoon Cafe", area: "Hauz Khas", score: 92 },
  { name: "Brew & Bloom", area: "Greater Kailash", score: 88 },
  { name: "The Chai Room", area: "Khan Market", score: 81 },
  { name: "Bean There", area: "Saket", score: 77 },
  { name: "Copper Kettle", area: "Defence Colony", score: 73 },
];

const MESSAGE = "Hi Priya — loved the new reels for Monsoon Cafe. We help cafés in South Delhi turn Instagram views into weekend bookings. Worth a 15-minute chat on Thursday?";

/** Types `text` out character by character, then holds and restarts. */
function useTypewriter(text: string, active: boolean) {
  const [length, setLength] = React.useState(0);
  React.useEffect(() => {
    if (!active) return;
    let index = 0;
    const timer = window.setInterval(() => {
      index = index >= text.length + 60 ? 0 : index + 1;
      setLength(Math.min(index, text.length));
    }, 38);
    return () => window.clearInterval(timer);
  }, [text, active]);
  return active ? text.slice(0, length) : text;
}

function ScoreRing({ score }: { score: number }) {
  const tone = score >= 85 ? "text-success-text" : score >= 75 ? "text-accent" : "text-warning-text";
  return (
    <span className={cn("relative flex size-8 items-center justify-center text-[11px] font-semibold tabular", tone)}>
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
        <circle cx="18" cy="18" r="15" className="stroke-surface-sunken" strokeWidth="3" fill="none" />
        <motion.circle cx="18" cy="18" r="15" className="stroke-current" strokeWidth="3" fill="none" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: score / 100 }} transition={{ duration: 1.1, ease: EASE_OUT }} />
      </svg>
      {score}
    </span>
  );
}

function ProductMock() {
  const reduce = useReducedMotion();
  // Re-run the discovery animation every few seconds so the demo feels alive.
  const [cycle, setCycle] = React.useState(0);
  React.useEffect(() => {
    if (reduce) return;
    const timer = window.setInterval(() => setCycle((value) => value + 1), 9000);
    return () => window.clearInterval(timer);
  }, [reduce]);
  const typed = useTypewriter(MESSAGE, !reduce);

  return (
    <div className="relative mx-auto w-full max-w-[640px]">
      {/* The app window */}
      <motion.div
        initial={{ opacity: 0, y: 40, rotateX: 12 }}
        animate={{ opacity: 1, y: 0, rotateX: 0 }}
        transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.35 }}
        style={{ transformPerspective: 1200 }}
        className="relative overflow-hidden rounded-2xl border border-border bg-surface/85 shadow-lg backdrop-blur-xl"
      >
        <div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 flex h-6 flex-1 items-center gap-1.5 rounded-md bg-surface-muted px-2 text-[11px] text-foreground-muted">
            <Search className="size-3" /> cafés in South Delhi with 2+ outlets that need more weekend covers
          </span>
        </div>
        <div className="grid gap-3 p-4">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold">Discovered leads</p>
            <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10.5px] font-medium text-accent-soft-foreground">
              <Sparkles className="size-3" /> scored with reasons
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-surface-sunken">
            <motion.div key={cycle} className="bg-brand-gradient h-full" initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: 2.4, ease: "easeInOut" }} />
          </div>
          <ul className="grid gap-1.5">
            <AnimatePresence mode="popLayout">
              {LEADS.map((lead, index) => (
                <motion.li
                  key={`${cycle}-${lead.name}`}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + index * 0.35, duration: 0.45, ease: EASE_OUT }}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2"
                >
                  <span className="flex size-7 items-center justify-center rounded-md bg-surface-sunken text-[10px] font-semibold text-foreground-secondary">{lead.name.split(" ").map((word) => word[0]).join("").slice(0, 2)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium">{lead.name}</span>
                    <span className="flex items-center gap-1 text-[11px] text-foreground-muted">
                      <MapPin className="size-3" /> {lead.area}
                    </span>
                  </span>
                  <ScoreRing score={lead.score} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>
      </motion.div>

      {/* Floating: AI-written message */}
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 1.1, duration: 0.6, ease: EASE_OUT }}
        className="absolute -right-2 -bottom-10 w-[260px] sm:-right-10 sm:w-[290px]"
      >
        <div className="animate-float rounded-xl border border-border bg-surface-raised p-3 shadow-lg" style={{ animationDelay: "0.5s" }}>
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-foreground-muted">
            <Sparkles className="size-3 text-brand-2" /> AI draft · waiting for your approval
          </p>
          <p className="mt-1.5 min-h-[72px] text-[12px] leading-relaxed text-foreground-secondary">
            {typed}
            <span className="ml-0.5 inline-block h-3.5 w-px translate-y-0.5 animate-pulse bg-foreground" />
          </p>
        </div>
      </motion.div>

      {/* Floating: AI call */}
      <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.5, duration: 0.6, ease: EASE_OUT }} className="absolute top-24 -left-4 hidden w-[220px] sm:-left-16 sm:block">
        <div className="animate-float rounded-xl border border-border bg-surface-raised p-3 shadow-lg" style={{ animationDelay: "1.4s" }}>
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-foreground-muted">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-good opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-good" />
            </span>
            <PhoneCall className="size-3" /> AI call · live
          </p>
          <div className="mt-2 grid gap-1.5 text-[11.5px]">
            <p className="w-fit max-w-[90%] rounded-lg rounded-tl-sm bg-surface-muted px-2 py-1">Would a quick call on Thursday work?</p>
            <p className="ml-auto w-fit max-w-[90%] rounded-lg rounded-tr-sm bg-accent-soft px-2 py-1 text-accent-soft-foreground">Thursday afternoon is good.</p>
          </div>
          <motion.p initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 2.6, type: "spring", stiffness: 300, damping: 18 }} className="mt-2 inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[10.5px] font-medium text-success-text">
            <CalendarCheck className="size-3" /> Meeting booked · Thu 3:00 pm
          </motion.p>
        </div>
      </motion.div>

      {/* Floating: deal won */}
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.9, duration: 0.6, ease: EASE_OUT }} className="absolute -top-8 right-6 hidden sm:block">
        <div className="animate-float flex items-center gap-2.5 rounded-xl border border-border bg-surface-raised px-3 py-2 shadow-lg" style={{ animationDelay: "2.2s" }}>
          <span className="bg-brand-gradient flex size-8 items-center justify-center rounded-lg text-white">
            <Trophy className="size-4" />
          </span>
          <span>
            <span className="block text-[11px] text-foreground-muted">Quote accepted</span>
            <span className="block text-[13px] font-semibold tabular">Deal won · ₹2,10,000</span>
          </span>
        </div>
      </motion.div>
    </div>
  );
}

const word = { hidden: { opacity: 0, y: 18, filter: "blur(6px)" }, show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.6, ease: EASE_OUT } } };

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden pt-28 pb-28 sm:pt-36 sm:pb-36">
      <Aurora intensity={1.3} />
      <div aria-hidden className="bg-grid absolute inset-0 -z-10 opacity-50 [mask-image:radial-gradient(ellipse_60%_55%_at_50%_30%,black,transparent)]" />
      <div className="mx-auto grid max-w-6xl items-center gap-16 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08 } } }}>
          <motion.a variants={word} href="/product" className="border-gradient inline-flex items-center gap-2 rounded-full bg-surface/70 px-3 py-1 text-xs font-medium text-foreground-secondary backdrop-blur">
            <Sparkles className="size-3.5 text-brand-2" />
            <span>
              Discovery → outreach → AI calls → CRM<span className="hidden sm:inline">, in one place</span>
            </span>
            <ArrowRight className="size-3" />
          </motion.a>
          <h1 className="mt-6 text-[44px] leading-[1.02] font-semibold tracking-[-0.04em] text-balance sm:text-[60px]">
            <motion.span variants={word} className="block">
              Find the right buyers.
            </motion.span>
            <motion.span variants={word} className="block">
              Win them on <span className="text-gradient animate-gradient-pan">autopilot</span>.
            </motion.span>
          </h1>
          <motion.p variants={word} className="mt-6 max-w-lg text-[16px] leading-relaxed text-foreground-secondary">
            Describe what you sell. {brand.name} finds businesses that need it, scores every lead with visible reasons, writes the outreach, calls with an AI voice agent and books the meeting — and you approve as much or as little as you like.
          </motion.p>
          <motion.div variants={word} className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild variant="primary" size="lg" className="relative overflow-hidden px-5 shadow-[var(--brand-glow)]">
              <Link href="/signup">
                Start free <ArrowRight />
                <span aria-hidden className="absolute inset-y-0 left-0 w-10 bg-white/25 blur-md" style={{ animation: "sheen 3.2s ease-in-out infinite" }} />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg" className="px-5">
              <Link href="/product">See how it works</Link>
            </Button>
          </motion.div>
          <motion.ul variants={word} className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-[12.5px] text-foreground-muted">
            {["Free plan, no card", "Every AI action reviewable", "Never invents prices"].map((item) => (
              <li key={item} className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5 text-good" /> {item}
              </li>
            ))}
          </motion.ul>
        </motion.div>
        <ProductMock />
      </div>
    </section>
  );
}
