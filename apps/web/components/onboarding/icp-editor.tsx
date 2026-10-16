"use client";

import * as React from "react";
import { Crosshair, MapPin, Sparkles, Target, UserRound, Zap } from "lucide-react";
import { motion } from "motion/react";
import type { Icp } from "@repo/core/business/schemas";
import { EASE_OUT, Field, FieldHint, Input, Label, Textarea } from "@repo/ui";
import { TagInput } from "../forms/tag-input";

function Group({ icon: Icon, title, children, delay = 0 }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode; delay?: number }) {
  return (
    <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4, ease: EASE_OUT }} className="rounded-xl border border-border bg-surface p-4 shadow-xs">
      <p className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
        <span className="flex size-6 items-center justify-center rounded-md bg-accent-soft text-accent-soft-foreground">
          <Icon className="size-3.5" />
        </span>
        {title}
      </p>
      <div className="grid gap-4">{children}</div>
    </motion.section>
  );
}

/** Editable ideal customer profile (used in onboarding and in Settings → Business & services). */
export function IcpEditor({ icp, onChange }: { icp: Icp; onChange: (icp: Icp) => void }) {
  const set = <K extends keyof Icp>(key: K, value: Icp[K]) => onChange({ ...icp, [key]: value });
  return (
    <div className="grid gap-4">
      <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, ease: EASE_OUT }} className="border-gradient relative overflow-hidden rounded-xl bg-surface p-4">
        <span aria-hidden className="bg-brand-gradient absolute -top-12 -right-12 size-32 rounded-full opacity-15 blur-2xl" />
        <p className="flex items-center gap-1.5 text-[11.5px] font-semibold tracking-wide text-brand-1 uppercase">
          <Sparkles className="size-3.5" /> How we understand your business
        </p>
        <p className="relative mt-2 text-[14px] leading-relaxed">{icp.summary}</p>
      </motion.div>

      <Group icon={Target} title="Who to look for" delay={0.05}>
        <Field>
          <Label>Ideal customer</Label>
          <Textarea rows={2} value={icp.idealCustomerProfile.description} onChange={(event) => set("idealCustomerProfile", { ...icp.idealCustomerProfile, description: event.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <Label>Business categories to target</Label>
            <TagInput value={icp.targetCategories} onChange={(value) => set("targetCategories", value)} />
            <FieldHint>Used as search categories when discovering leads.</FieldHint>
          </Field>
          <Field>
            <Label>Target industries</Label>
            <TagInput value={icp.targetIndustries} onChange={(value) => set("targetIndustries", value)} />
          </Field>
        </div>
        <Field>
          <Label>Must-haves</Label>
          <TagInput value={icp.idealCustomerProfile.mustHaves} onChange={(value) => set("idealCustomerProfile", { ...icp.idealCustomerProfile, mustHaves: value })} />
        </Field>
      </Group>

      <Group icon={MapPin} title="Where and how to find them" delay={0.1}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <Label>Recommended locations</Label>
            <TagInput value={icp.recommendedLocations} onChange={(value) => set("recommendedLocations", value)} />
          </Field>
          <Field>
            <Label>Lead keywords</Label>
            <TagInput value={icp.leadKeywords} onChange={(value) => set("leadKeywords", value)} />
          </Field>
        </div>
        {icp.buyingSignals.length ? (
          <Field>
            <Label>Buying signals we&apos;ll look for</Label>
            <div className="flex flex-wrap gap-1.5">
              {icp.buyingSignals.map((signal, index) => (
                <motion.span key={signal.key} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.15 + index * 0.04 }} title={signal.description} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-muted px-2.5 py-1 text-[12px] text-foreground-secondary">
                  <Zap className="size-3 text-brand-2" /> {signal.label}
                </motion.span>
              ))}
            </div>
          </Field>
        ) : null}
      </Group>

      {icp.buyerPersonas.length ? (
        <Group icon={UserRound} title="Buyer personas" delay={0.15}>
          <div className="grid gap-3 sm:grid-cols-2">
            {icp.buyerPersonas.map((persona, index) => (
              <div key={index} className="rounded-lg border border-border bg-background p-3">
                <Input value={persona.title} aria-label="Persona title" onChange={(event) => set("buyerPersonas", icp.buyerPersonas.map((p, i) => (i === index ? { ...p, title: event.target.value } : p)))} className="font-medium" />
                <p className="mt-2 text-[11px] font-semibold tracking-wide text-foreground-muted uppercase">Goals</p>
                <p className="text-[12.5px] text-foreground-secondary">{persona.goals.join(" · ")}</p>
                <p className="mt-2 text-[11px] font-semibold tracking-wide text-foreground-muted uppercase">Pain points</p>
                <p className="text-[12.5px] text-foreground-secondary">{persona.painPoints.join(" · ")}</p>
              </div>
            ))}
          </div>
        </Group>
      ) : null}

      <Group icon={Crosshair} title="How to pitch" delay={0.2}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <Label>Outreach angle</Label>
            <Textarea rows={3} value={icp.outreachAngle} onChange={(event) => set("outreachAngle", event.target.value)} />
          </Field>
          <Field>
            <Label>Value proposition</Label>
            <Textarea rows={3} value={icp.valueProposition} onChange={(event) => set("valueProposition", event.target.value)} />
          </Field>
        </div>
      </Group>
    </div>
  );
}
