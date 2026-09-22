"use client";

import * as React from "react";
import {
  ArrowDown,
  Bell,
  CalendarCheck,
  Check,
  CheckCircle2,
  Clock,
  FileText,
  GitBranch,
  Globe,
  Camera,
  ListChecks,
  Mail,
  MapPin,
  MessageCircle,
  Mic,
  PhoneCall,
  RefreshCw,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { AnimatedNumber, EASE_OUT, cn } from "@repo/ui";
import type { DemoKey } from "./site";
import { DemoFrame } from "./ui";

/** Runs `tick` every `ms` while the element is on screen (and motion is allowed). */
function useTicker(ref: React.RefObject<Element | null>, ms: number, tick: () => void) {
  const inView = useInView(ref, { amount: 0.3 });
  const reduce = useReducedMotion();
  const saved = React.useRef(tick);
  React.useEffect(() => {
    saved.current = tick;
  });
  React.useEffect(() => {
    if (!inView || reduce) return;
    const timer = window.setInterval(() => saved.current(), ms);
    return () => window.clearInterval(timer);
  }, [inView, reduce, ms]);
  return { inView, reduce: Boolean(reduce) };
}

function ScoreRing({ score, size = 32 }: { score: number; size?: number }) {
  const tone = score >= 85 ? "text-success-text" : score >= 70 ? "text-accent" : "text-warning-text";
  return (
    <span className={cn("relative flex shrink-0 items-center justify-center text-[11px] font-semibold tabular", tone)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
        <circle cx="18" cy="18" r="15" className="stroke-surface-sunken" strokeWidth="3" fill="none" />
        <motion.circle cx="18" cy="18" r="15" className="stroke-current" strokeWidth="3" fill="none" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: score / 100 }} transition={{ duration: 1, ease: EASE_OUT }} />
      </svg>
      {score}
    </span>
  );
}

// ----------------------------------------------------------------------------- Discovery

const DISCOVERY_QUERY = "cafés in South Delhi with 2+ outlets";
const DISCOVERY_CHIPS = ["Category · Cafés", "Area · South Delhi", "Signal · 2+ outlets"];
const DISCOVERY_LEADS = [
  { name: "Monsoon Cafe", area: "Hauz Khas", score: 92, factors: [30, 20, 26, 16], sources: ["Google Places", "Website", "Instagram"] },
  { name: "Brew & Bloom", area: "Greater Kailash", score: 86, factors: [30, 18, 22, 16], sources: ["Google Places", "Website"] },
  { name: "The Chai Room", area: "Khan Market", score: 78, factors: [26, 20, 18, 14], sources: ["Google Places", "Instagram"] },
  { name: "Bean There", area: "Saket", score: 71, factors: [26, 16, 17, 12], sources: ["Google Places"] },
];
const FACTOR_LABELS = [
  { label: "Industry fit", max: 30 },
  { label: "Location", max: 20 },
  { label: "Signals", max: 30 },
  { label: "AI judgement", max: 20 },
];
const SOURCE_ICON: Record<string, React.ComponentType<{ className?: string }>> = { "Google Places": MapPin, Website: Globe, Instagram: Camera };

function DiscoveryDemo() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [selected, setSelected] = React.useState(0);
  const [pinned, setPinned] = React.useState(false);
  const { reduce } = useTicker(ref, 3200, () => {
    if (!pinned) setSelected((value) => (value + 1) % DISCOVERY_LEADS.length);
  });
  // Play the search once, the first time the demo is seen; it stays put afterwards.
  const seen = useInView(ref, { once: true, amount: 0.3 });
  const lead = DISCOVERY_LEADS[selected]!;
  const started = seen || reduce;

  return (
    <div ref={ref}>
      <DemoFrame title="Discover">
        <div className="grid gap-4 p-4">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 shadow-xs">
            <Search className="size-4 text-foreground-muted" />
            <span className="flex-1 truncate text-[13px]">
              {started ? (
                <motion.span initial={{ clipPath: "inset(0 100% 0 0)" }} animate={{ clipPath: "inset(0 0% 0 0)" }} transition={{ duration: reduce ? 0 : 1.4, ease: "linear" }} className="inline-block">
                  {DISCOVERY_QUERY}
                </motion.span>
              ) : null}
            </span>
            <span className="bg-brand-gradient rounded-md px-2 py-1 text-[11px] font-semibold text-white">Search</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {DISCOVERY_CHIPS.map((chip, index) => (
              <motion.span key={chip} initial={{ opacity: 0, scale: 0.8 }} animate={started ? { opacity: 1, scale: 1 } : {}} transition={{ delay: reduce ? 0 : 1.5 + index * 0.15, type: "spring", stiffness: 380, damping: 20 }} className="rounded-full border border-border bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent-soft-foreground">
                {chip}
              </motion.span>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
            <ul className="grid gap-1.5" aria-label="Example results">
              {DISCOVERY_LEADS.map((item, index) => (
                <motion.li key={item.name} initial={{ opacity: 0, x: -14 }} animate={started ? { opacity: 1, x: 0 } : {}} transition={{ delay: reduce ? 0 : 2 + index * 0.18, duration: 0.45, ease: EASE_OUT }}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(index);
                      setPinned(true);
                    }}
                    className={cn("relative flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors", selected === index ? "border-transparent" : "border-border bg-surface hover:bg-surface-muted")}
                  >
                    {selected === index ? <motion.span layoutId="discovery-selected" className="border-gradient absolute inset-0 rounded-lg bg-accent-soft/40" transition={{ type: "spring", stiffness: 400, damping: 32 }} /> : null}
                    <span className="relative flex size-7 items-center justify-center rounded-md bg-surface-sunken text-[10px] font-semibold text-foreground-secondary">
                      {item.name
                        .split(" ")
                        .map((word) => word[0])
                        .join("")
                        .slice(0, 2)}
                    </span>
                    <span className="relative min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium">{item.name}</span>
                      <span className="flex items-center gap-1 text-[11px] text-foreground-muted">
                        <MapPin className="size-3" /> {item.area}
                      </span>
                    </span>
                    <span className="relative">
                      <ScoreRing score={item.score} />
                    </span>
                  </button>
                </motion.li>
              ))}
            </ul>
            <motion.div initial={{ opacity: 0 }} animate={started ? { opacity: 1 } : {}} transition={{ delay: reduce ? 0 : 2.6 }} className="rounded-lg border border-border bg-background/70 p-3">
              <p className="text-[11px] font-semibold tracking-wide text-foreground-muted uppercase">Why {lead.score}?</p>
              <p className="mt-0.5 text-[13px] font-semibold">{lead.name}</p>
              <div className="mt-3 grid gap-2.5">
                {FACTOR_LABELS.map((factor, index) => (
                  <div key={factor.label}>
                    <div className="flex justify-between text-[11px] text-foreground-secondary">
                      <span>{factor.label}</span>
                      <span className="tabular">
                        {lead.factors[index]}/{factor.max}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                      <motion.div className="bg-brand-gradient h-full rounded-full" initial={false} animate={{ width: `${((lead.factors[index] ?? 0) / factor.max) * 100}%` }} transition={{ duration: 0.6, ease: EASE_OUT }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {lead.sources.map((source) => {
                  const Icon = SOURCE_ICON[source] ?? Globe;
                  return (
                    <span key={source} className="inline-flex items-center gap-1 rounded-md bg-surface-muted px-1.5 py-0.5 text-[10.5px] text-foreground-secondary">
                      <Icon className="size-3" /> {source}
                    </span>
                  );
                })}
              </div>
            </motion.div>
          </div>
        </div>
      </DemoFrame>
    </div>
  );
}

// ----------------------------------------------------------------------------- Outreach

const OUTREACH = {
  email: {
    subject: "More weekend covers at Monsoon Cafe?",
    parts: [
      { text: "Hi Priya — saw " },
      { text: "the new brunch menu", fact: "Website" },
      { text: " and that you now run " },
      { text: "two outlets in Hauz Khas and Saket", fact: "Google Places" },
      { text: ". We help cafés turn Instagram views into weekend bookings. Worth a 15-minute chat on Thursday?" },
    ],
  },
  whatsapp: {
    subject: "WhatsApp template · intro_offer",
    parts: [
      { text: "Hi Priya 👋 loved " },
      { text: "the latest reels", fact: "Instagram" },
      { text: " from Monsoon Cafe! We help cafés in " },
      { text: "South Delhi", fact: "Lead profile" },
      { text: " fill weekend tables. Can I share two ideas?" },
    ],
  },
};
const SEQUENCE = [
  { day: "Day 0", label: "Email", icon: Mail, state: "sent" },
  { day: "Day 3", label: "WhatsApp", icon: MessageCircle, state: "sent" },
  { day: "Day 7", label: "Follow-up email", icon: Mail, state: "stopped" },
] as const;

function OutreachDemo() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [channel, setChannel] = React.useState<"email" | "whatsapp">("email");
  const [approved, setApproved] = React.useState(false);
  const inView = useInView(ref, { amount: 0.3, once: true });
  const message = OUTREACH[channel];
  return (
    <div ref={ref}>
      <DemoFrame title="Review queue · Delhi Cafés">
        <div className="grid gap-4 p-4">
          <div className="flex items-center justify-between gap-2">
            <div role="radiogroup" aria-label="Channel" className="inline-flex rounded-md border border-border bg-surface-muted p-0.5">
              {(["email", "whatsapp"] as const).map((value) => (
                <button key={value} type="button" role="radio" aria-checked={channel === value} onClick={() => { setChannel(value); setApproved(false); }} className={cn("relative rounded px-3 py-1 text-[12px] font-medium", channel === value ? "text-foreground" : "text-foreground-muted")}>
                  {channel === value ? <motion.span layoutId="outreach-channel" className="absolute inset-0 rounded bg-surface shadow-xs" /> : null}
                  <span className="relative">{value === "email" ? "Email" : "WhatsApp"}</span>
                </button>
              ))}
            </div>
            <span className="inline-flex items-center gap-1 text-[11px] text-foreground-muted">
              <Sparkles className="size-3 text-brand-2" /> AI draft
            </span>
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={channel} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }} className={cn("rounded-xl border border-border p-4", channel === "whatsapp" ? "bg-success-soft/40" : "bg-background")}>
              <p className="text-[11.5px] font-medium text-foreground-muted">{message.subject}</p>
              <p className="mt-2 text-[13.5px] leading-relaxed">
                {message.parts.map((part, index) =>
                  "fact" in part && part.fact ? (
                    <span key={index} className="group relative rounded bg-accent-soft px-0.5 text-accent-soft-foreground">
                      {part.text}
                      <span className="pointer-events-none absolute -top-6 left-0 hidden rounded bg-foreground px-1.5 py-0.5 text-[10px] whitespace-nowrap text-background group-hover:block">from {part.fact}</span>
                    </span>
                  ) : (
                    <span key={index}>{part.text}</span>
                  ),
                )}
              </p>
              <p className="mt-3 text-[11px] text-foreground-muted">Highlighted phrases come from the lead&apos;s real data — hover to see the source.</p>
            </motion.div>
          </AnimatePresence>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setApproved(true)} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors", approved ? "bg-success-soft text-success-text" : "bg-foreground text-background hover:opacity-90")}>
              {approved ? <CheckCircle2 className="size-3.5" /> : <Check className="size-3.5" />} {approved ? "Approved — sending" : "Approve & send"}
            </button>
            <span className="rounded-md border border-border px-3 py-1.5 text-[12px] text-foreground-secondary">Edit</span>
            <span className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-[12px] text-foreground-secondary">
              <RefreshCw className="size-3" /> Regenerate
            </span>
          </div>
          <ol className="grid grid-cols-3 gap-2" aria-label="Sequence">
            {SEQUENCE.map((step, index) => (
              <motion.li key={step.day} initial={{ opacity: 0, y: 10 }} animate={inView ? { opacity: 1, y: 0 } : {}} transition={{ delay: 0.3 + index * 0.2 }} className={cn("rounded-lg border p-2.5", step.state === "stopped" ? "border-dashed border-border-strong opacity-70" : "border-border bg-surface")}>
                <p className="flex items-center gap-1 text-[10.5px] font-semibold text-foreground-muted uppercase">
                  <step.icon className="size-3" /> {step.day}
                </p>
                <p className="mt-1 text-[12px] font-medium">{step.label}</p>
                <p className={cn("mt-1 text-[10.5px]", step.state === "sent" ? "text-success-text" : "text-foreground-muted")}>{step.state === "sent" ? "✓ Sent" : "Stopped — they replied"}</p>
              </motion.li>
            ))}
          </ol>
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={inView ? { opacity: 1, scale: 1 } : {}} transition={{ delay: 1.2, type: "spring", stiffness: 260, damping: 20 }} className="ml-auto w-fit max-w-[85%] rounded-xl rounded-br-sm bg-accent-soft px-3 py-2 text-[12.5px] text-accent-soft-foreground">
            “Thursday works — send me some times?”
            <span className="mt-1 block text-[10.5px] font-semibold">Classified: meeting request</span>
          </motion.div>
        </div>
      </DemoFrame>
    </div>
  );
}

// ----------------------------------------------------------------------------- Calling

const CALL_LINES = [
  { who: "agent", text: "Hi, this is an AI assistant calling for Northwind Social. Is this Priya from Monsoon Cafe?" },
  { who: "prospect", text: "Yes, speaking." },
  { who: "agent", text: "You opened our note about weekend bookings — would a 15-minute chat with our team be useful?" },
  { who: "prospect", text: "We already have an agency, honestly." },
  { who: "agent", text: "Understood. We only run reels-to-bookings campaigns, so it can sit alongside them. Worth a quick look?" },
  { who: "prospect", text: "Okay — Thursday afternoon is good." },
] as const;

function Waveform({ active }: { active: boolean }) {
  return (
    <div className="flex h-8 items-center gap-[3px]" aria-hidden>
      {Array.from({ length: 22 }, (_, bar) => (
        <motion.span key={bar} className="bg-brand-gradient w-1 rounded-full" animate={active ? { height: [6, 10 + ((bar * 37) % 22), 6] } : { height: 6 }} transition={{ duration: 1.1, repeat: active ? Infinity : 0, delay: bar * 0.04, ease: "easeInOut" }} />
      ))}
    </div>
  );
}

function CallingDemo() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [shown, setShown] = React.useState(0);
  const total = CALL_LINES.length;
  const { reduce } = useTicker(ref, 1500, () => setShown((value) => (value >= total + 3 ? 0 : value + 1)));
  const visible = reduce ? total : Math.min(shown, total);
  const done = reduce || shown > total;
  const seconds = Math.min(shown, total) * 7;
  return (
    <div ref={ref}>
      <DemoFrame title="AI call · Monsoon Cafe">
        <div className="grid gap-3 p-4">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2">
            <span className="relative flex size-2.5">
              {!done ? <span className="absolute inline-flex size-full animate-ping rounded-full bg-good opacity-60" /> : null}
              <span className={cn("relative inline-flex size-2.5 rounded-full", done ? "bg-foreground-subtle" : "bg-good")} />
            </span>
            <span className="text-[12.5px] font-medium">{done ? "Call ended" : "Live"}</span>
            <span className="text-[12px] text-foreground-muted tabular">
              0:{String(seconds).padStart(2, "0")}
            </span>
            <span className="ml-auto">
              <Waveform active={!done} />
            </span>
          </div>
          <div className="grid min-h-[228px] content-start gap-1.5" aria-live="polite">
            {visible === 0 ? (
              <p className="flex items-center gap-2 py-2 text-[12px] text-foreground-muted">
                <PhoneCall className="size-3.5 animate-pulse" /> Dialling Monsoon Cafe…
              </p>
            ) : null}
            <AnimatePresence initial={false}>
              {CALL_LINES.slice(0, visible).map((line, index) => (
                <motion.p key={index} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className={cn("max-w-[85%] rounded-lg px-2.5 py-1.5 text-[12px] leading-snug", line.who === "agent" ? "rounded-tl-sm bg-surface-muted" : "ml-auto rounded-tr-sm bg-accent-soft text-accent-soft-foreground")}>
                  <span className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold opacity-70">
                    {line.who === "agent" ? <Mic className="size-2.5" /> : <PhoneCall className="size-2.5" />} {line.who === "agent" ? "AI agent" : "Priya"}
                  </span>
                  {line.text}
                </motion.p>
              ))}
            </AnimatePresence>
          </div>
          <AnimatePresence>
            {done ? (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.4, ease: EASE_OUT }} className="border-gradient grid gap-2 rounded-xl bg-surface p-3 sm:grid-cols-3">
                <div>
                  <p className="text-[10.5px] font-semibold text-foreground-muted uppercase">Outcome</p>
                  <p className="mt-0.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-success-text">
                    <CalendarCheck className="size-3.5" /> Meeting · Thu 3 pm
                  </p>
                </div>
                <div>
                  <p className="text-[10.5px] font-semibold text-foreground-muted uppercase">Interest</p>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                    <motion.div className="bg-brand-gradient h-full" initial={{ width: 0 }} animate={{ width: "80%" }} transition={{ duration: 0.8, ease: EASE_OUT }} />
                  </div>
                  <p className="mt-1 text-[11px] text-foreground-secondary">8 / 10</p>
                </div>
                <div>
                  <p className="text-[10.5px] font-semibold text-foreground-muted uppercase">Objection</p>
                  <p className="mt-0.5 text-[12px]">Has an agency — handled</p>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </DemoFrame>
    </div>
  );
}

// ----------------------------------------------------------------------------- Workflows

const FLOW = [
  { icon: Zap, label: "Reply classified as positive", kind: "Trigger" },
  { icon: GitBranch, label: "Lead score ≥ 70?", kind: "Condition" },
  { icon: ListChecks, label: "Move deal to Interested", kind: "Action" },
  { icon: Bell, label: "Notify the team (app + Slack)", kind: "Action" },
];

function WorkflowsDemo() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [step, setStep] = React.useState(0);
  const { reduce } = useTicker(ref, 1100, () => setStep((value) => (value >= FLOW.length + 2 ? 0 : value + 1)));
  const current = reduce ? FLOW.length : step;
  return (
    <div ref={ref}>
      <DemoFrame title="Workflow · Hot reply hand-off">
        <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
          <ol className="grid justify-items-center gap-0" aria-label="Workflow steps">
            {FLOW.map((node, index) => {
              const state = index < current ? "done" : index === current ? "running" : "idle";
              return (
                <li key={node.label} className="flex w-full flex-col items-center">
                  <motion.div animate={{ scale: state === "running" ? 1.03 : 1 }} className={cn("flex w-full max-w-[260px] items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors", state === "done" ? "border-success-text/30 bg-success-soft/50" : state === "running" ? "border-gradient bg-surface shadow-[var(--brand-glow)]" : "border-border bg-surface")}>
                    <span className={cn("flex size-7 items-center justify-center rounded-md", index === 0 ? "bg-foreground text-background" : "bg-surface-muted text-foreground-secondary")}>
                      <node.icon className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[10px] font-semibold text-foreground-muted uppercase">{node.kind}</span>
                      <span className="block truncate text-[12px] font-medium">{node.label}</span>
                    </span>
                    {state === "done" ? <CheckCircle2 className="size-4 text-success-text" /> : null}
                  </motion.div>
                  {index < FLOW.length - 1 ? (
                    <span className="relative h-6 w-px overflow-hidden bg-border">
                      <motion.span className="bg-brand-gradient absolute inset-x-0 top-0" initial={false} animate={{ height: index < current ? "100%" : "0%" }} transition={{ duration: 0.4 }} />
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
          <div className="rounded-lg border border-border bg-background/70 p-3">
            <p className="text-[11px] font-semibold tracking-wide text-foreground-muted uppercase">Run history</p>
            <ul className="mt-2 grid gap-1.5 font-mono text-[11px]">
              {FLOW.slice(0, Math.min(current, FLOW.length)).map((node, index) => (
                <motion.li key={node.label} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-1.5 text-foreground-secondary">
                  <span className="text-success-text">✓</span>
                  <span className="text-foreground-muted tabular">+{(index * 0.4).toFixed(1)}s</span>
                  <span className="truncate">{node.label}</span>
                </motion.li>
              ))}
              {current >= FLOW.length ? (
                <motion.li initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-1 font-sans text-[11.5px] font-semibold text-success-text">
                  Run completed in 1.2s
                </motion.li>
              ) : (
                <li className="flex items-center gap-1.5 text-foreground-muted">
                  <Clock className="size-3 animate-spin [animation-duration:2s]" /> running…
                </li>
              )}
            </ul>
          </div>
        </div>
      </DemoFrame>
    </div>
  );
}

// ----------------------------------------------------------------------------- CRM & quotes

const STAGES = ["Interested", "Meeting", "Proposal", "Won"];
const LINES = [
  { item: "Social media management", detail: "6 months × ₹35,000", amount: 210_000 },
  { item: "Volume discount (6+ months)", detail: "10%", amount: -21_000 },
  { item: "Setup fee", detail: "Waived", amount: 0 },
];
const inr = (value: number) => `₹${value.toLocaleString("en-IN")}`;

function CrmDemo() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [stage, setStage] = React.useState(0);
  const { reduce } = useTicker(ref, 1600, () => setStage((value) => (value + 1) % (STAGES.length + 1)));
  const current = reduce ? STAGES.length - 1 : Math.min(stage, STAGES.length - 1);
  const subtotal = LINES.reduce((sum, line) => sum + line.amount, 0);
  const tax = Math.round(subtotal * 0.18);
  return (
    <div ref={ref}>
      <DemoFrame title="CRM · Pipeline and quote Q-0042">
        <div className="grid gap-4 p-4">
          <div className="grid grid-cols-4 gap-1.5">
            {STAGES.map((name, index) => (
              <div key={name} className="flex min-h-[84px] flex-col gap-1.5 rounded-lg bg-surface-muted/70 p-1.5">
                <p className="px-1 text-[10.5px] font-semibold text-foreground-muted">{name}</p>
                {current === index ? (
                  <motion.div layoutId="crm-demo-card" transition={{ type: "spring", stiffness: 380, damping: 30 }} className={cn("rounded-md border px-2 py-1.5 text-[10.5px] font-medium shadow-sm", index === STAGES.length - 1 ? "border-transparent bg-success-soft text-success-text" : "border-border bg-surface")}>
                    Monsoon Cafe
                    <span className="block font-normal text-foreground-muted">{inr(subtotal)}</span>
                  </motion.div>
                ) : null}
              </div>
            ))}
          </div>
          <div className="relative rounded-xl border border-border bg-background p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                  <FileText className="size-4 text-brand-1" /> Quote Q-0042
                </p>
                <p className="text-[11px] text-foreground-muted">For Monsoon Cafe · valid 14 days</p>
              </div>
              <AnimatePresence>
                {current === STAGES.length - 1 ? (
                  <motion.span initial={{ opacity: 0, scale: 1.6, rotate: -18 }} animate={{ opacity: 1, scale: 1, rotate: -8 }} exit={{ opacity: 0 }} transition={{ type: "spring", stiffness: 300, damping: 16 }} className="rounded-md border-2 border-success-text px-2 py-0.5 text-[12px] font-bold tracking-wide text-success-text uppercase">
                    Accepted
                  </motion.span>
                ) : null}
              </AnimatePresence>
            </div>
            <table className="mt-3 w-full text-[11.5px]">
              <tbody>
                {LINES.map((line) => (
                  <tr key={line.item} className="border-b border-border last:border-0">
                    <td className="py-1.5">
                      {line.item}
                      <span className="block text-[10.5px] text-foreground-muted">{line.detail}</span>
                    </td>
                    <td className="py-1.5 text-right tabular">{line.amount < 0 ? `− ${inr(-line.amount)}` : inr(line.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 grid gap-0.5 text-[11.5px]">
              <p className="flex justify-between text-foreground-secondary">
                <span>GST 18%</span>
                <span className="tabular">{inr(tax)}</span>
              </p>
              <p className="flex justify-between text-[13px] font-semibold">
                <span>Total</span>
                <span className="tabular">{inr(subtotal + tax)}</span>
              </p>
            </div>
            <p className="mt-2 text-[10.5px] text-foreground-muted">Prices from your catalog and pricing rules only.</p>
          </div>
        </div>
      </DemoFrame>
    </div>
  );
}

// ----------------------------------------------------------------------------- Analytics

const FUNNEL = [
  { label: "Contacted", value: 120 },
  { label: "Replied", value: 38 },
  { label: "Positive", value: 17 },
  { label: "Meetings", value: 9 },
  { label: "Won", value: 4 },
];

function AnalyticsDemo() {
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.3, once: true });
  const [evidence, setEvidence] = React.useState(false);
  return (
    <div ref={ref}>
      <DemoFrame title="Analytics · last 30 days">
        <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-lg border border-border bg-background p-3">
            <p className="text-[11px] font-semibold tracking-wide text-foreground-muted uppercase">Funnel</p>
            <ul className="mt-3 grid gap-2">
              {FUNNEL.map((stage, index) => (
                <li key={stage.label} className="grid grid-cols-[72px_minmax(0,1fr)_32px] items-center gap-2 text-[11.5px]">
                  <span className="text-foreground-secondary">{stage.label}</span>
                  <span className="h-3 overflow-hidden rounded-sm bg-surface-sunken">
                    <motion.span className="block h-full rounded-sm bg-series-1" initial={{ width: 0 }} animate={inView ? { width: `${(stage.value / FUNNEL[0]!.value) * 100}%` } : {}} transition={{ delay: index * 0.12, duration: 0.8, ease: EASE_OUT }} style={{ opacity: 1 - index * 0.13 }} />
                  </span>
                  <span className="text-right font-medium tabular">{inView ? <AnimatedNumber value={stage.value} /> : 0}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid content-start gap-3">
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Reply rate", value: 31.7, format: (v: number) => `${v.toFixed(1)}%` },
                { label: "Cost / meeting", value: 1450, format: (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}` },
              ].map((tile) => (
                <div key={tile.label} className="rounded-lg border border-border bg-background p-2.5">
                  <p className="text-[10.5px] text-foreground-muted">{tile.label}</p>
                  <p className="text-[18px] font-semibold tracking-[-0.02em] tabular">{inView ? <AnimatedNumber value={tile.value} format={tile.format} /> : tile.format(0)}</p>
                </div>
              ))}
            </div>
            <div className="border-gradient rounded-xl bg-surface p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-1">
                <Sparkles className="size-3" /> Insight · Channels
              </p>
              <p className="mt-1 text-[12.5px] font-semibold">AI calls get more positive responses than email</p>
              <div className="mt-2 flex items-center gap-2 text-[11px] text-foreground-muted">
                High confidence
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                  <motion.span className="block h-full bg-good" initial={{ width: 0 }} animate={inView ? { width: "97%" } : {}} transition={{ delay: 0.6, duration: 0.8, ease: EASE_OUT }} />
                </span>
                97%
              </div>
              <button type="button" onClick={() => setEvidence(!evidence)} aria-expanded={evidence} className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-foreground-secondary hover:text-foreground">
                <ArrowDown className={cn("size-3 transition-transform", evidence && "rotate-180")} /> {evidence ? "Hide evidence" : "Show evidence"}
              </button>
              <AnimatePresence initial={false}>
                {evidence ? (
                  <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden text-[11px] leading-relaxed text-foreground-secondary">
                    14 of 40 called leads responded positively vs 6 of 42 emailed. Two-proportion z-test, p = 0.03.
                  </motion.p>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </DemoFrame>
    </div>
  );
}

export const DEMOS: Record<DemoKey, React.ComponentType> = {
  discovery: DiscoveryDemo,
  outreach: OutreachDemo,
  calling: CallingDemo,
  workflows: WorkflowsDemo,
  crm: CrmDemo,
  analytics: AnalyticsDemo,
};

export function ProductDemo({ demo }: { demo: DemoKey }) {
  const Demo = DEMOS[demo];
  return <Demo />;
}

