"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, Check, Loader2, Mail, MessageSquare, PlayCircle, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { brand } from "@repo/config";
import { Button, EASE_OUT, Input, Label, Reveal, Textarea, cn } from "@repo/ui";
import { useSiteSearch } from "./site-search";
import { PageIntro } from "./ui";

const TOPICS = [
  { value: "SALES", label: "Sales & pricing" },
  { value: "SUPPORT", label: "Account help" },
  { value: "PARTNERSHIP", label: "Partnerships" },
  { value: "PRESS", label: "Press" },
  { value: "OTHER", label: "Something else" },
] as const;
type Topic = (typeof TOPICS)[number]["value"];
type Fields = Partial<Record<"name" | "email" | "company" | "topic" | "message", string[]>>;

const MAX_MESSAGE = 5000;

function FieldError({ id, messages }: { id: string; messages?: string[] }) {
  return (
    <AnimatePresence initial={false}>
      {messages?.length ? (
        <motion.p id={id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="text-[12.5px] text-danger-text">
          {messages[0]}
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
}

function Success({ name, email, onReset }: { name: string; email: string; onReset: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, ease: EASE_OUT }} className="flex flex-col items-center py-10 text-center" role="status">
      <span className="bg-brand-gradient flex size-16 items-center justify-center rounded-full text-white shadow-[var(--brand-glow)]">
        <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.2, duration: 0.5, ease: EASE_OUT }} />
        </svg>
      </span>
      <h2 className="mt-6 text-[22px] font-semibold tracking-[-0.02em]">Thanks, {name.split(" ")[0]} — message received.</h2>
      <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-foreground-secondary">
        It&apos;s with our team now. We&apos;ll reply to <span className="font-medium text-foreground">{email}</span>.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button asChild variant="primary">
          <Link href="/login">
            Explore the live demo <ArrowRight />
          </Link>
        </Button>
        <Button variant="secondary" onClick={onReset}>
          Send another message
        </Button>
      </div>
    </motion.div>
  );
}

function ContactForm({ initialTopic }: { initialTopic: Topic }) {
  const [topic, setTopic] = React.useState<Topic>(initialTopic);
  const [message, setMessage] = React.useState("");
  const [fields, setFields] = React.useState<Fields>({});
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [sent, setSent] = React.useState<{ name: string; email: string } | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      company: String(form.get("company") ?? ""),
      topic,
      message,
      website: String(form.get("website") ?? ""),
      source: typeof document !== "undefined" && document.referrer ? safePath(document.referrer) : undefined,
    };
    setPending(true);
    setError(null);
    setFields({});
    try {
      const response = await fetch("/api/public/contact", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = (await response.json().catch(() => null)) as { error?: { message: string; fields?: Fields } } | null;
      if (!response.ok) {
        setFields(body?.error?.fields ?? {});
        setError(body?.error?.message ?? "Something went wrong. Please try again.");
        return;
      }
      setSent({ name: payload.name, email: payload.email });
    } catch {
      setError(`We couldn't reach the server. Check your connection, or email ${brand.supportEmail}.`);
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <Success
        name={sent.name}
        email={sent.email}
        onReset={() => {
          setSent(null);
          setMessage("");
        }}
      />
    );
  }

  const invalid = (name: keyof Fields) => Boolean(fields[name]?.length);
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5" aria-describedby={error ? "contact-error" : undefined}>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="contact-name">Your name</Label>
          <Input id="contact-name" name="name" autoComplete="name" required aria-invalid={invalid("name")} aria-describedby="contact-name-error" className={cn(invalid("name") && "border-critical")} />
          <FieldError id="contact-name-error" messages={fields.name} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="contact-email">Work email</Label>
          <Input id="contact-email" name="email" type="email" autoComplete="email" required aria-invalid={invalid("email")} aria-describedby="contact-email-error" className={cn(invalid("email") && "border-critical")} />
          <FieldError id="contact-email-error" messages={fields.email} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="contact-company">
          Company <span className="font-normal text-foreground-muted">(optional)</span>
        </Label>
        <Input id="contact-company" name="company" autoComplete="organization" />
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-[13px] font-medium">What&apos;s it about?</legend>
        <div role="radiogroup" aria-label="Topic" className="flex flex-wrap gap-2">
          {TOPICS.map((option) => {
            const active = topic === option.value;
            return (
              <button key={option.value} type="button" role="radio" aria-checked={active} onClick={() => setTopic(option.value)} className={cn("relative rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors", active ? "border-transparent text-background" : "border-border bg-surface text-foreground-secondary hover:text-foreground")}>
                {active ? <motion.span layoutId="contact-topic" className="absolute inset-0 rounded-full bg-foreground" transition={{ type: "spring", stiffness: 500, damping: 36 }} /> : null}
                <span className="relative inline-flex items-center gap-1">
                  {active ? <Check className="size-3.5" /> : null}
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="contact-message">Message</Label>
          <span className={cn("text-[12px] tabular", message.length > MAX_MESSAGE ? "text-danger-text" : "text-foreground-muted")}>
            {message.length.toLocaleString()} / {MAX_MESSAGE.toLocaleString()}
          </span>
        </div>
        <Textarea id="contact-message" name="message" rows={6} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="What are you selling, who to, and what would you like to know?" required aria-invalid={invalid("message")} aria-describedby="contact-message-error" className={cn("resize-y", invalid("message") && "border-critical")} />
        <FieldError id="contact-message-error" messages={fields.message} />
      </div>
      {/* Honeypot: invisible to people and screen readers. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="contact-website">Website</label>
        <input id="contact-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <AnimatePresence>
        {error ? (
          <motion.p id="contact-error" role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-lg border border-critical/30 bg-danger-soft px-3 py-2 text-[13px] text-danger-text">
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] text-foreground-muted">
          We use your details only to reply. See our{" "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
            privacy policy
          </Link>
          .
        </p>
        <Button type="submit" variant="primary" size="lg" disabled={pending} className="min-w-40 shadow-[var(--brand-glow)]">
          {pending ? <Loader2 className="animate-spin" /> : null}
          {pending ? "Sending…" : "Send message"}
        </Button>
      </div>
    </form>
  );
}

function safePath(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.origin === window.location.origin ? parsed.pathname : undefined;
  } catch {
    return undefined;
  }
}

function SideCard({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 rounded-2xl border border-border bg-surface p-5">
      <span className="border-gradient flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface">
        <Icon className="size-4 text-brand-1" />
      </span>
      <div className="min-w-0">
        <h3 className="text-[14.5px] font-semibold">{title}</h3>
        <div className="mt-1 text-[13.5px] leading-relaxed text-foreground-secondary">{children}</div>
      </div>
    </div>
  );
}

export function ContactPageView({ initialTopic }: { initialTopic: Topic }) {
  const { open } = useSiteSearch();
  return (
    <>
      <PageIntro crumbs={[{ href: "/", label: "Home" }, { label: "Contact" }]} eyebrow="Contact" icon={MessageSquare} title="Talk to a human about your pipeline" highlight="your pipeline" description="Questions about plans, a setup that fits your channels, or help with your account — send us a note and we'll get back to you by email." center />
      <section className="pb-24">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 sm:px-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <Reveal className="relative rounded-3xl border border-border bg-surface p-6 shadow-lg sm:p-8">
            <ContactForm initialTopic={initialTopic} />
          </Reveal>
          <Reveal delay={0.1} className="grid content-start gap-4">
            <SideCard icon={Mail} title="Email us">
              <a href={`mailto:${brand.supportEmail}`} className="font-medium text-foreground underline-offset-2 hover:underline">
                {brand.supportEmail}
              </a>
            </SideCard>
            <SideCard icon={PlayCircle} title="See it working first">
              The live demo is a fully seeded workspace.{" "}
              <Link href="/login" className="font-medium text-foreground underline-offset-2 hover:underline">
                Open the demo
              </Link>
            </SideCard>
            <SideCard icon={BookOpen} title="Compare plans">
              Every limit and feature is on the{" "}
              <Link href="/pricing#compare" className="font-medium text-foreground underline-offset-2 hover:underline">
                pricing page
              </Link>
              .
            </SideCard>
            <SideCard icon={Search} title="Looking for something specific?">
              <button type="button" onClick={open} className="font-medium text-foreground underline-offset-2 hover:underline">
                Search the site
              </button>{" "}
              for features and answers.
            </SideCard>
          </Reveal>
        </div>
      </section>
    </>
  );
}
