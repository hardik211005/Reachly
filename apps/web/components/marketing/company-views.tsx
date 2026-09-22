"use client";

import * as React from "react";
import Link from "next/link";
import {
  Activity,
  Download,
  Eye,
  FileKey2,
  FileText,
  Fingerprint,
  Gauge,
  Heart,
  KeyRound,
  Lock,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
  Webhook,
} from "lucide-react";
import { motion } from "motion/react";
import { brand } from "@repo/config";
import { Reveal, SpotlightCard, Stagger, StaggerItem, cn } from "@repo/ui";
import { Facts } from "./sections";
import { CtaBand, PageIntro, PrimaryActions, SectionHeading } from "./ui";

// ----------------------------------------------------------------------------- About

const PRINCIPLES = [
  { icon: Eye, title: "Real data only", body: "Leads show their sources, messages cite real facts, quotes use your prices and analytics come from recorded events. Nothing is invented to look good." },
  { icon: SlidersHorizontal, title: "You stay in control", body: "Every campaign chooses its autonomy: review everything, approve in bulk, or let it run within limits you set." },
  { icon: Sparkles, title: "Show the working", body: "Scores explain themselves, insights state their sample size and confidence, and every automation keeps a step-by-step history." },
  { icon: ShieldCheck, title: "Compliance is a feature", body: "Opt-outs, unsubscribe links, WhatsApp rules, calling consent and quiet hours are enforced by the engine, not left to memory." },
];

export function AboutView() {
  return (
    <>
      <PageIntro
        crumbs={[{ href: "/", label: "Home" }, { label: "About" }]}
        eyebrow="About"
        icon={Heart}
        title="Selling to businesses shouldn’t take five tools and a spreadsheet"
        highlight="five tools and a spreadsheet"
        description={`${brand.name} brings finding, qualifying, reaching and closing B2B customers into one workspace — with AI doing the repetitive work and people keeping the judgement.`}
        actions={<PrimaryActions secondary={{ href: "/contact", label: "Get in touch" }} />}
        center
      />
      <section className="pb-20">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <SectionHeading eyebrow="Why we built it" title="The busywork was winning" highlight="busywork" center={false} />
          <Reveal className="grid gap-5 text-[16px] leading-relaxed text-foreground-secondary">
            <p>Small teams that sell to other businesses spend their week searching maps and directories, copying phone numbers into spreadsheets, rewriting the same email for every prospect and trying to remember who needed a follow-up.</p>
            <p>Larger companies solve this with sales-ops teams and a stack of expensive software. We wanted the same loop — find, qualify, reach, close, learn — in one place that a small team can run in an afternoon.</p>
            <p>So {brand.name} is built around one idea: AI should do the repetitive work, and show you exactly what it did. You decide what goes out, and every number you see can be traced back to what actually happened.</p>
          </Reveal>
        </div>
      </section>
      <section className="border-y border-border bg-surface py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading eyebrow="Principles" title="What we won’t compromise on" highlight="won’t compromise" />
          <Stagger inView step={0.08} className="mt-12 grid gap-4 sm:grid-cols-2">
            {PRINCIPLES.map((principle) => (
              <StaggerItem key={principle.title}>
                <SpotlightCard className="lift h-full rounded-2xl border border-border bg-background p-6">
                  <span className="border-gradient flex size-10 items-center justify-center rounded-xl bg-surface">
                    <principle.icon className="size-5 text-brand-1" />
                  </span>
                  <h3 className="mt-4 text-[17px] font-semibold">{principle.title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-foreground-secondary">{principle.body}</p>
                </SpotlightCard>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>
      <section className="pt-16">
        <SectionHeading eyebrow="What's inside" title="Built for the whole loop" />
        <Facts />
      </section>
      <CtaBand />
    </>
  );
}

// ----------------------------------------------------------------------------- Security

const MEASURES = [
  { icon: Users, title: "Workspace isolation", body: "Every database query is scoped to your workspace by the data layer itself, so one workspace can never read another's records." },
  { icon: Lock, title: "Encrypted credentials", body: "Provider keys and tokens you connect are encrypted at rest with AES-256-GCM and are never shown again after saving." },
  { icon: KeyRound, title: "Hashed API keys", body: "API keys are shown once. We store only a SHA-256 hash, so a leaked database doesn't leak working keys." },
  { icon: Fingerprint, title: "Roles and permissions", body: "Owner, Admin, Member and Viewer roles control who can send, call, change settings or see billing." },
  { icon: ScrollText, title: "Audit log", body: "Sensitive actions — consent, suppression, deletions and settings changes — are recorded with who did them and when." },
  { icon: Webhook, title: "Signed webhooks", body: "Inbound provider webhooks are verified; outbound webhooks and n8n calls are signed with HMAC-SHA256 so you can verify them." },
  { icon: Gauge, title: "Rate limits", body: "API routes, public pages and sign-in are rate limited to slow down abuse and credential stuffing." },
  { icon: FileKey2, title: "Signed links", body: "Public quote links and unsubscribe links carry signed, purpose-bound tokens that can't be guessed or reused elsewhere." },
  { icon: Activity, title: "Compliance controls", body: "Unsubscribe and one-click unsubscribe, cross-channel opt-outs, WhatsApp opt-in and 24-hour rules, DND checks and calling hours." },
  { icon: Download, title: "Your data stays yours", body: "Export leads, deals, analytics and more as CSV whenever you like." },
];

export function SecurityView() {
  return (
    <>
      <PageIntro
        crumbs={[{ href: "/", label: "Home" }, { label: "Security" }]}
        eyebrow="Security"
        icon={ShieldCheck}
        title="Protected by design, not by a settings page"
        highlight="by design"
        description="You trust us with your pipeline and your prospects' details. Here's exactly how that data is protected."
        center
      />
      <section className="pb-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Stagger inView step={0.05} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {MEASURES.map((measure) => (
              <StaggerItem key={measure.title}>
                <SpotlightCard className="lift h-full rounded-2xl border border-border bg-surface p-5 shadow-xs">
                  <measure.icon className="size-5 text-brand-1" />
                  <h3 className="mt-4 text-[15px] font-semibold">{measure.title}</h3>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-foreground-secondary">{measure.body}</p>
                </SpotlightCard>
              </StaggerItem>
            ))}
          </Stagger>
          <Reveal className="mt-12 grid gap-4 rounded-2xl border border-border bg-surface p-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:p-8">
            <span className="bg-brand-gradient flex size-12 items-center justify-center rounded-2xl text-white shadow-[var(--brand-glow)]">
              <ShieldCheck className="size-6" />
            </span>
            <div>
              <h2 className="text-[18px] font-semibold">Found a vulnerability?</h2>
              <p className="mt-1 text-[14px] leading-relaxed text-foreground-secondary">
                Please email <a href={`mailto:${brand.supportEmail}?subject=Security%20report`} className="font-medium text-foreground underline underline-offset-2">{brand.supportEmail}</a> with the details and steps to reproduce. Don&apos;t access data that isn&apos;t yours, and give us a chance to fix it before sharing.
              </p>
            </div>
          </Reveal>
        </div>
      </section>
      <CtaBand title="Questions about security?" highlight="Ask us anything." description="We're happy to walk through how your data is handled." />
    </>
  );
}

// ----------------------------------------------------------------------------- Legal documents

export interface LegalSection {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

export function LegalView({ title, updated, intro, sections }: { title: string; updated: string; intro: string; sections: LegalSection[] }) {
  const [active, setActive] = React.useState(sections[0]?.id ?? "");
  React.useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -65% 0px" },
    );
    for (const section of sections) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [sections]);

  return (
    <>
      <PageIntro crumbs={[{ href: "/", label: "Home" }, { label: title }]} eyebrow="Legal" icon={FileText} title={title} description={<>{intro} <span className="mt-2 block text-[13px] text-foreground-muted">Last updated {updated}</span></>} />
      <section className="pb-24">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="On this page" className="hidden lg:block">
            <div className="sticky top-24">
              <p className="text-[12px] font-semibold tracking-wide text-foreground-muted uppercase">On this page</p>
              <ul className="mt-3 grid gap-0.5 border-l border-border">
                {sections.map((section) => (
                  <li key={section.id} className="relative">
                    {active === section.id ? <motion.span layoutId="legal-toc" className="bg-brand-gradient absolute top-0 bottom-0 -left-px w-0.5 rounded-full" /> : null}
                    <a href={`#${section.id}`} className={cn("block py-1.5 pl-4 text-[13px] transition-colors", active === section.id ? "font-medium text-foreground" : "text-foreground-muted hover:text-foreground")}>
                      {section.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
          <article className="max-w-3xl">
            {sections.map((section, index) => (
              <Reveal key={section.id} amount={0.05}>
                <section id={section.id} className="scroll-mt-24 border-b border-border py-8 first:pt-0 last:border-0">
                  <h2 className="text-[20px] font-semibold tracking-[-0.02em]">
                    <span className="mr-2 text-foreground-subtle tabular">{String(index + 1).padStart(2, "0")}</span>
                    {section.title}
                  </h2>
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph.slice(0, 40)} className="mt-3 text-[15px] leading-relaxed text-foreground-secondary">
                      {paragraph}
                    </p>
                  ))}
                  {section.bullets ? (
                    <ul className="mt-3 grid gap-2">
                      {section.bullets.map((bullet) => (
                        <li key={bullet} className="flex gap-2.5 text-[15px] leading-relaxed text-foreground-secondary">
                          <span className="bg-brand-gradient mt-2.5 size-1.5 shrink-0 rounded-full" />
                          {bullet}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              </Reveal>
            ))}
            <p className="mt-8 text-[14px] text-foreground-secondary">
              Questions about this document? <Link href="/contact" className="font-medium text-foreground underline underline-offset-2">Contact us</Link> or email {brand.supportEmail}.
            </p>
          </article>
        </div>
      </section>
    </>
  );
}
