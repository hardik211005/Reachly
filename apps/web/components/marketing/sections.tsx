"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  ClipboardCheck,
  Database,
  FileText,
  Handshake,
  Lock,
  Mail,
  MessageCircle,
  PhoneCall,
  Radar,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Telescope,
  Workflow,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";
import { CHANNELS, type PlanDefinition } from "@repo/config";
import { STEP_CATALOG } from "@repo/core/workflows/schemas";
import { AnimatedNumber, Button, EASE_OUT, Reveal, SpotlightCard, Stagger, StaggerItem, cn } from "@repo/ui";
import { USE_CASES } from "./site";
import { SectionHeading } from "./ui";

// ----------------------------------------------------------------------------- Integrations marquee

const INTEGRATIONS = ["Google Places", "Resend", "SendGrid", "SMTP", "WhatsApp Cloud API", "Twilio", "Vapi", "n8n", "Stripe", "OpenAI", "Anthropic", "Google Gemini", "Slack", "Webhooks"];

export function IntegrationsMarquee() {
  return (
    <section aria-label="Works with" className="border-y border-border bg-surface/60 py-6">
      <p className="text-center text-xs font-medium tracking-wide text-foreground-muted uppercase">Connects to the tools you already use</p>
      <div className="relative mt-4 overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]">
        <div className="flex w-max animate-marquee gap-3">
          {[...INTEGRATIONS, ...INTEGRATIONS].map((name, index) => (
            <span key={`${name}-${index}`} className="rounded-full border border-border bg-surface px-4 py-1.5 text-[13px] font-medium whitespace-nowrap text-foreground-secondary">
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- How it works

const STEPS = [
  { icon: Sparkles, title: "Describe your business", body: "Tell it what you sell and to whom. AI builds your ideal customer profile — which you can edit — in about a minute." },
  { icon: Telescope, title: "Discover leads", body: "Ask in plain words, like “cafés in South Delhi with 2+ outlets”. Every lead shows where it was found." },
  { icon: Radar, title: "Qualify with reasons", body: "Each lead gets a transparent score: industry fit, location, signals and AI judgement, factor by factor." },
  { icon: Mail, title: "Reach out on every channel", body: "Personalised email, WhatsApp templates and AI voice calls in sequences that stop the moment someone replies." },
  { icon: Handshake, title: "Close and learn", body: "Replies become deals, meetings and priced quotes. Analytics and AI insights show what's working." },
];

export function HowItWorks() {
  const ref = React.useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 70%", "end 60%"] });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 24 });
  return (
    <section id="how" className="scroll-mt-20 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading eyebrow="How it works" title="From an idea to booked meetings in five steps" highlight="booked meetings" description="Each step works on its own and hands off to the next — with you deciding how much runs automatically." />
        <div ref={ref} className="relative mx-auto mt-16 max-w-3xl">
          <div aria-hidden className="absolute top-0 bottom-0 left-[23px] w-px bg-border sm:left-1/2" />
          <motion.div aria-hidden className="bg-brand-gradient absolute top-0 left-[23px] w-px origin-top sm:left-1/2" style={{ height: "100%", scaleY: progress }} />
          <ol className="grid gap-12">
            {STEPS.map((step, index) => (
              <li key={step.title} className={cn("relative grid items-center gap-4 pl-16 sm:grid-cols-2 sm:gap-12 sm:pl-0", index % 2 === 1 && "sm:[&>div:first-child]:order-2")}>
                <Reveal className={cn("sm:text-right", index % 2 === 1 && "sm:text-left")} y={24}>
                  <p className="text-xs font-semibold tracking-wide text-foreground-muted tabular">STEP {index + 1}</p>
                  <h3 className="mt-1 text-lg font-semibold tracking-[-0.01em]">{step.title}</h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-foreground-secondary">{step.body}</p>
                </Reveal>
                <div className="hidden sm:block" />
                <motion.span
                  initial={{ scale: 0.4, opacity: 0 }}
                  whileInView={{ scale: 1, opacity: 1 }}
                  viewport={{ once: true, amount: 0.8 }}
                  transition={{ type: "spring", stiffness: 260, damping: 18 }}
                  className="absolute top-0 left-0 flex size-12 items-center justify-center rounded-xl border border-border bg-surface shadow-md sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2"
                >
                  <step.icon className="size-5 text-brand-1" />
                </motion.span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- Feature bento (with live mini-illustrations)

function PulseMap() {
  const pins = [
    { x: "22%", y: "38%", delay: 0 },
    { x: "48%", y: "28%", delay: 0.6 },
    { x: "66%", y: "54%", delay: 1.2 },
    { x: "35%", y: "66%", delay: 1.8 },
    { x: "78%", y: "30%", delay: 2.4 },
  ];
  return (
    <div className="bg-grid relative h-40 overflow-hidden rounded-lg border border-border bg-surface-muted/60 [background-size:22px_22px]">
      {pins.map((pin) => (
        <span key={pin.x} className="absolute" style={{ left: pin.x, top: pin.y }}>
          <span className="absolute -inset-3 rounded-full bg-brand-1/20" style={{ animation: `pulse-ring 2.4s ease-out ${pin.delay}s infinite` }} />
          <span className="relative block size-2.5 rounded-full bg-brand-1 ring-4 ring-surface" />
        </span>
      ))}
      <div className="absolute right-3 bottom-3 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium shadow-sm">
        <AnimatedNumber value={24} /> leads found
      </div>
    </div>
  );
}

function MessageStack() {
  const lines = ["Subject: More weekend covers at Monsoon Cafe?", "Hi Priya — saw the new brunch menu…", "Follow-up · 3 days later if no reply"];
  return (
    <div className="grid h-40 content-center gap-2">
      {lines.map((line, index) => (
        <motion.div key={line} initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 + index * 0.25, duration: 0.5, ease: EASE_OUT }} className={cn("rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-foreground-secondary shadow-xs", index === 2 && "ml-8 border-dashed")}>
          {line}
        </motion.div>
      ))}
    </div>
  );
}

function Waveform() {
  const reduce = useReducedMotion();
  const bars = Array.from({ length: 28 }, (_, index) => index);
  return (
    <div className="flex h-40 items-center justify-center gap-[3px]">
      {bars.map((bar) => (
        <motion.span
          key={bar}
          className="bg-brand-gradient w-1.5 rounded-full"
          initial={{ height: 8 }}
          animate={reduce ? { height: 20 } : { height: [8, 12 + ((bar * 37) % 48), 10, 18 + ((bar * 53) % 40), 8] }}
          transition={{ duration: 1.8, repeat: Infinity, delay: bar * 0.04, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

function FlowGraph() {
  const nodes = ["Reply received", "Positive?", "Move deal", "Notify team"];
  return (
    <div className="grid h-40 content-center gap-1.5">
      {nodes.map((node, index) => (
        <div key={node} className="flex flex-col items-center">
          <motion.span initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: index * 0.2 }} className={cn("rounded-md border px-3 py-1 text-[11.5px] font-medium shadow-xs", index === 0 ? "bg-foreground text-background" : "border-border bg-surface")}>
            {node}
          </motion.span>
          {index < nodes.length - 1 ? (
            <span className="relative h-3 w-px overflow-hidden bg-border">
              <span className="bg-brand-gradient absolute inset-x-0 top-0 h-2 w-px" style={{ animation: `marquee-down 1.4s linear ${index * 0.3}s infinite` }} />
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function MiniKanban() {
  const reduce = useReducedMotion();
  const [column, setColumn] = React.useState(0);
  React.useEffect(() => {
    if (reduce) return;
    const timer = window.setInterval(() => setColumn((value) => (value + 1) % 3), 1800);
    return () => window.clearInterval(timer);
  }, [reduce]);
  const columns = ["Meeting", "Proposal", "Won"];
  return (
    <div className="grid h-40 grid-cols-3 gap-2">
      {columns.map((name, index) => (
        <div key={name} className="flex flex-col gap-1.5 rounded-lg bg-surface-muted/70 p-1.5">
          <p className="px-1 text-[10.5px] font-semibold text-foreground-muted">{name}</p>
          <div className="h-7 rounded-md border border-border bg-surface" />
          <AnimatePresence>
            {column === index ? (
              <motion.div layoutId="kanban-card" transition={{ type: "spring", stiffness: 380, damping: 30 }} className={cn("rounded-md border px-2 py-1.5 text-[10.5px] font-medium shadow-sm", index === 2 ? "border-transparent bg-success-soft text-success-text" : "border-border bg-surface")}>
                Monsoon Cafe
                <span className="block font-normal text-foreground-muted">₹2,10,000</span>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

function GrowingBars() {
  const values = [0.32, 0.45, 0.4, 0.62, 0.58, 0.8, 0.92];
  return (
    <div className="relative flex h-40 items-end gap-2 px-2">
      {values.map((value, index) => (
        <motion.span key={index} className="flex-1 rounded-t-md bg-series-1" initial={{ height: 0 }} whileInView={{ height: `${value * 100}%` }} viewport={{ once: true }} transition={{ delay: index * 0.08, duration: 0.8, ease: EASE_OUT }} style={{ opacity: 0.35 + value * 0.65 }} />
      ))}
      <motion.div initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.9 }} className="absolute top-2 left-2 flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-[11px] shadow-sm">
        <Sparkles className="size-3 text-brand-2" /> Example insight · WhatsApp beats email
      </motion.div>
    </div>
  );
}

function CopilotChat() {
  const reduce = useReducedMotion();
  const answer = ["3 replies need you", "2 tasks due today", "Monsoon Cafe opened your quote twice"];
  return (
    <div className="flex h-40 flex-col justify-center gap-2">
      <motion.div initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.4, ease: EASE_OUT }} className="ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-foreground px-3 py-1.5 text-[12px] text-background">
        What needs me today?
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.5, duration: 0.4, ease: EASE_OUT }} className="max-w-[90%] rounded-lg rounded-bl-sm border border-border bg-surface px-3 py-2 text-[12px] shadow-xs">
        <span className="mb-1 flex items-center gap-1 text-[10.5px] font-semibold text-brand-1">
          <Bot className="size-3" /> Copilot
        </span>
        <ul className="grid gap-0.5 text-foreground-secondary">
          {answer.map((line, index) => (
            <motion.li key={line} initial={{ opacity: 0, x: -6 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: reduce ? 0 : 0.8 + index * 0.2 }} className="flex items-center gap-1.5">
              <Check className="size-3 text-success-text" /> {line}
            </motion.li>
          ))}
        </ul>
      </motion.div>
    </div>
  );
}

const FEATURES = [
  { icon: Telescope, title: "Lead engine", href: "/product/lead-discovery", body: "Natural-language discovery across providers, enrichment from public sources, de-duplication and a transparent score for every lead.", visual: PulseMap, span: "md:col-span-2" },
  { icon: Mail, title: "AI outreach", href: "/product/ai-outreach", body: "Messages grounded in real facts about each business, in your tone. Review each one, auto-approve, or go fully automated.", visual: MessageStack, span: "" },
  { icon: PhoneCall, title: "AI voice agent", href: "/product/ai-calling", body: "Calls with a brief, answers objections honestly, books meetings at the time the prospect said — and discloses it's an AI.", visual: Waveform, span: "" },
  { icon: Workflow, title: "Workflows & n8n", href: "/product/workflows", body: "Visual automations with test runs, full step history, signed webhooks and two-way n8n.", visual: FlowGraph, span: "" },
  { icon: Handshake, title: "CRM & quotes", href: "/product/crm-quotes", body: "Drag-and-drop pipeline that updates itself, and priced quotes from your catalog with PDF and online acceptance.", visual: MiniKanban, span: "" },
  { icon: BarChart3, title: "Analytics & AI insights", href: "/product/analytics", body: "Funnels, cohorts, heatmaps and cost per meeting — plus insights with sample sizes and confidence.", visual: GrowingBars, span: "lg:col-span-2" },
  { icon: Bot, title: "AI copilot", href: "/product", body: "Ask in plain words — what needs you, which deals are stuck, which quotes went unopened — and jump straight to it.", visual: CopilotChat, span: "" },
];

export function FeaturesBento() {
  return (
    <section id="features" className="scroll-mt-20 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading eyebrow="Product" title="Everything between “who should we sell to?” and “deal won”" highlight="“deal won”" description="One workspace instead of a lead database, an email tool, a dialler, a CRM and a spreadsheet." />
        <Stagger inView step={0.08} className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <StaggerItem key={feature.title} className={feature.span}>
              <SpotlightCard className="lift group relative flex h-full flex-col rounded-2xl border border-border bg-surface p-5 shadow-xs">
                <feature.visual />
                <div className="mt-5 flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-md bg-accent-soft text-accent-soft-foreground">
                    <feature.icon className="size-4" />
                  </span>
                  <h3 className="text-[15px] font-semibold">
                    <Link href={feature.href} className="after:absolute after:inset-0 after:rounded-2xl after:content-['']">
                      {feature.title}
                    </Link>
                  </h3>
                </div>
                <p className="mt-2 text-[13.5px] leading-relaxed text-foreground-secondary">{feature.body}</p>
                <span className="mt-auto inline-flex items-center gap-1 pt-4 text-[12.5px] font-medium text-brand-1">
                  Learn more <ArrowRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-1" />
                </span>
              </SpotlightCard>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- Trust

const TRUST = [
  { icon: FileText, title: "Never invents prices", body: "Quotes and AI drafts only use prices from your catalog or ones you type in." },
  { icon: ClipboardCheck, title: "You choose the autonomy", body: "Manual, assisted or automated — per campaign, with a review queue for every AI message." },
  { icon: ShieldCheck, title: "Compliance built in", body: "Unsubscribe links, opt-outs, WhatsApp opt-in and 24-hour rules, calling consent and quiet hours." },
  { icon: Database, title: "Every number is real", body: "Analytics come from an immutable event log. Insights show their sample size and confidence." },
  { icon: Lock, title: "Isolated and encrypted", body: "Each workspace's data is isolated; provider keys are encrypted at rest." },
  { icon: ScrollText, title: "Audited", body: "Sensitive actions — consent, suppression, deletions, settings — are logged with who and when." },
];

export function Trust() {
  return (
    <section id="trust" className="relative isolate scroll-mt-20 overflow-hidden border-y border-border bg-surface py-24 sm:py-32">
      <div aria-hidden className="bg-grid absolute inset-0 -z-10 opacity-30 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading eyebrow="Trust" title="Automation you can actually leave running" highlight="actually leave running" description="Guardrails aren't a settings page — they're in the engine." />
        <Stagger inView step={0.06} className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TRUST.map((item) => (
            <StaggerItem key={item.title}>
              <div className="flex h-full gap-4 rounded-xl border border-border bg-background/70 p-5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface shadow-xs">
                  <item.icon className="size-5 text-brand-1" />
                </span>
                <div>
                  <h3 className="text-[14.5px] font-semibold">{item.title}</h3>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-foreground-secondary">{item.body}</p>
                </div>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- Facts (product facts, not customer claims)

const FACTS = [
  { value: 11, label: "specialised AI agents", icon: Bot },
  { value: CHANNELS.length, label: "outreach channels", icon: MessageCircle },
  { value: Object.keys(STEP_CATALOG).length, label: "workflow step types", icon: Workflow },
  { value: 20, label: "analytics metrics", icon: BarChart3 },
];

export function Facts() {
  const ref = React.useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [40, -40]);
  return (
    <section className="py-20">
      <motion.div ref={ref} style={{ y }} className="mx-auto grid max-w-5xl grid-cols-2 gap-6 px-4 sm:px-6 lg:grid-cols-4">
        {FACTS.map((fact) => (
          <Reveal key={fact.label} className="text-center">
            <fact.icon className="mx-auto size-5 text-foreground-muted" />
            <p className="text-gradient mt-3 text-[44px] leading-none font-semibold tracking-[-0.04em]">
              <AnimatedNumber value={fact.value} duration={1.4} />
            </p>
            <p className="mt-2 text-[13px] text-foreground-secondary">{fact.label}</p>
          </Reveal>
        ))}
      </motion.div>
    </section>
  );
}

// ----------------------------------------------------------------------------- Pricing

const PLAN_POINTS = (plan: PlanDefinition): string[] => {
  const usage = plan.limits.usage;
  const number = (value: number | null, unit: string) => (value === null ? `Unlimited ${unit}` : `${value.toLocaleString("en-US")} ${unit}`);
  return [
    `${number(usage.LEAD_CREDITS, "leads")} / month`,
    `${number(usage.AI_CREDITS, "AI credits")} / month`,
    `${number(usage.EMAIL_SENDS, "emails")} / month`,
    usage.WHATSAPP_MESSAGES ? `${number(usage.WHATSAPP_MESSAGES, "WhatsApp messages")}` : "WhatsApp — not included",
    usage.VOICE_MINUTES ? `${number(usage.VOICE_MINUTES, "AI voice minutes")}` : "AI voice — not included",
    plan.limits.resources.members === null ? "Unlimited teammates" : `${plan.limits.resources.members} teammate${plan.limits.resources.members === 1 ? "" : "s"}`,
    ...(plan.features.workflows ? ["Workflows & n8n"] : []),
    ...(plan.features.aiInsights ? ["AI insights & advanced analytics"] : ["Core analytics"]),
    ...(plan.features.quotes ? ["Quotes with PDF & online acceptance"] : ["CRM pipeline"]),
    ...(plan.features.apiAccess ? ["API access & outbound webhooks"] : []),
  ];
};

/** `upi`: show the rupee price when UPI payments (Razorpay) are switched on for this deployment. */
export function Pricing({ plans, heading = true, compareLink = true, upi = false }: { plans: PlanDefinition[]; heading?: boolean; compareLink?: boolean; upi?: boolean }) {
  return (
    <section id="pricing" className={cn("scroll-mt-20", heading ? "py-24 sm:py-32" : "pb-8")}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {heading ? <SectionHeading eyebrow="Pricing" title="Start free. Upgrade when it’s paying for itself." highlight="paying for itself" description="Plans differ by volume and automation. Every plan includes the lead engine, the CRM and full data export." /> : null}
        <Stagger inView step={0.1} className="mt-14 grid gap-4 lg:grid-cols-3">
          {plans.map((plan) => {
            const featured = plan.highlighted;
            return (
              <StaggerItem key={plan.key}>
                <SpotlightCard className={cn("lift relative flex h-full flex-col rounded-2xl border bg-surface p-6 shadow-xs", featured ? "border-gradient border-transparent shadow-[var(--brand-glow)]" : "border-border")}>
                  {featured ? <span className="bg-brand-gradient absolute -top-3 left-6 rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white shadow-md">Recommended</span> : null}
                  <h3 className="text-[15px] font-semibold">{plan.name}</h3>
                  <p className="mt-1 min-h-10 text-[13px] leading-relaxed text-foreground-secondary">{plan.description}</p>
                  <p className="mt-5 flex items-baseline gap-1">
                    <span className="text-[40px] leading-none font-semibold tracking-[-0.04em]">${Math.round(plan.priceMonthly / 100)}</span>
                    <span className="text-[13px] text-foreground-muted">/ month</span>
                  </p>
                  {upi && plan.priceMonthlyInr ? <p className="mt-1.5 text-[12.5px] font-medium text-foreground-muted">or ₹{(plan.priceMonthlyInr / 100).toLocaleString("en-IN")} / month via UPI</p> : null}
                  <Button asChild variant={featured ? "primary" : "secondary"} className="mt-6 w-full">
                    <Link href={`/signup?plan=${plan.key}`}>{plan.priceMonthly === 0 ? "Start free" : `Choose ${plan.name}`}</Link>
                  </Button>
                  <ul className="mt-6 grid gap-2.5 text-[13px]">
                    {PLAN_POINTS(plan).map((point) => {
                      const excluded = point.includes("not included");
                      return (
                        <li key={point} className={cn("flex items-start gap-2", excluded ? "text-foreground-subtle" : "text-foreground-secondary")}>
                          <Check className={cn("mt-0.5 size-4 shrink-0", excluded ? "opacity-30" : "text-good")} />
                          {point}
                        </li>
                      );
                    })}
                  </ul>
                </SpotlightCard>
              </StaggerItem>
            );
          })}
        </Stagger>
        {compareLink ? (
          <Reveal className="mt-8 text-center">
            <Link href="/pricing#compare" className="group inline-flex items-center gap-1.5 text-[13.5px] font-medium text-foreground-secondary transition-colors hover:text-foreground">
              Compare every feature and limit <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </Reveal>
        ) : null}
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- Use cases strip

export function UseCasesStrip({ heading = true }: { heading?: boolean }) {
  return (
    <section className={heading ? "py-24 sm:py-28" : "pb-24"}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {heading ? <SectionHeading eyebrow="Use cases" title="Built for teams that sell to businesses" highlight="sell to businesses" description="The same engine, pointed at different buyers. Pick the one closest to you." /> : null}
        <Stagger inView step={0.08} className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-4", heading && "mt-14")}>
          {USE_CASES.map((item) => (
            <StaggerItem key={item.slug}>
              <SpotlightCard className="lift group relative flex h-full flex-col rounded-2xl border border-border bg-surface p-5 shadow-xs">
                <span className="border-gradient flex size-10 items-center justify-center rounded-xl bg-surface">
                  <item.icon className="size-5 text-brand-1" />
                </span>
                <h3 className="mt-4 text-[15px] font-semibold">
                  <Link href={`/use-cases/${item.slug}`} className="after:absolute after:inset-0 after:rounded-2xl after:content-['']">
                    {item.name}
                  </Link>
                </h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-foreground-secondary">{item.summary}</p>
                <p className="mt-4 rounded-lg bg-surface-muted px-3 py-2 text-[12px] leading-snug text-foreground-secondary">
                  <span className="font-medium text-foreground">Try: </span>“{item.exampleSearch}”
                </p>
                <span className="mt-auto inline-flex items-center gap-1 pt-4 text-[12.5px] font-medium text-brand-1">
                  See the playbook <ArrowRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-1" />
                </span>
              </SpotlightCard>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
