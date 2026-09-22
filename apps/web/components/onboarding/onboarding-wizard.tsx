"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Briefcase,
  Check,
  CheckCircle2,
  Globe,
  Hand,
  Lock,
  Mail,
  MapPin,
  Megaphone,
  MessageCircle,
  Package,
  Phone,
  PhoneCall,
  Plus,
  Radar,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sparkles,
  Target,
  Telescope,
  Trash2,
  Users,
  Zap,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AUTOMATION_MODE_LABELS, BUSINESS_SIZE_LABELS, BUSINESS_SIZES, CHANNEL_LABELS, type AutomationMode, type BusinessSize, type Channel } from "@repo/config";
import type { Icp } from "@repo/core/business/schemas";
import { Aurora, Badge, Button, Callout, EASE_OUT, Field, FieldError, FieldHint, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, cn, toast } from "@repo/ui";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { Logo } from "../brand/logo";
import { TagInput } from "../forms/tag-input";
import { IcpEditor } from "./icp-editor";

export { IcpEditor };

// ----------------------------------------------------------------------------- Types

export interface OfferingDraft {
  type: "PRODUCT" | "SERVICE" | "PACKAGE";
  name: string;
  description: string;
  unitPrice: string;
  unit: string;
  minOrderQuantity: string;
}

export interface OnboardingInitial {
  userName: string;
  hasWorkspace: boolean;
  newWorkspace: boolean;
  allowedModes: AutomationMode[];
  allowedChannels: Channel[];
  planName: string;
  currency: string;
  timezone: string;
  profile: {
    name: string;
    website: string;
    industry: string;
    description: string;
    city: string;
    region: string;
    country: string;
    businessSize: BusinessSize;
    pricingModel: string;
    targetIndustries: string[];
    targetCustomerTypes: string[];
    outreachTone: string;
  } | null;
  offerings: OfferingDraft[];
  icp: Icp | null;
}

const STEPS = [
  { label: "Business", icon: Briefcase },
  { label: "Ideal customers", icon: Target },
  { label: "First campaign", icon: Megaphone },
  { label: "Channels", icon: Mail },
  { label: "Automation", icon: Bot },
  { label: "Review", icon: Rocket },
] as const;

const EMPTY_OFFERING: OfferingDraft = { type: "SERVICE", name: "", description: "", unitPrice: "", unit: "unit", minOrderQuantity: "" };

const TONES = [
  { value: "professional", label: "Professional" },
  { value: "friendly", label: "Friendly" },
  { value: "concise", label: "Short & direct" },
  { value: "consultative", label: "Consultative" },
];

const CHANNEL_META: Record<Channel, { icon: React.ComponentType<{ className?: string }>; description: string }> = {
  EMAIL: { icon: Mail, description: "Personalised emails and follow-ups with unsubscribe handling." },
  WHATSAPP: { icon: MessageCircle, description: "Approved template messages via the official Business API." },
  VOICE: { icon: PhoneCall, description: "AI voice agent calls with consent controls and transcripts." },
  MANUAL_CALL: { icon: Phone, description: "AI prepares a call brief; you make the call." },
};

const MODE_META: Record<AutomationMode, { icon: React.ComponentType<{ className?: string }>; flow: string[] }> = {
  MANUAL: { icon: Hand, flow: ["You write or edit", "You send"] },
  ASSISTED: { icon: Bot, flow: ["AI drafts", "You approve", "It sends"] },
  AUTOMATED: { icon: Zap, flow: ["AI drafts", "Sends within your limits"] },
};

const ANALYSIS_STAGES = ["Reading your business profile", "Understanding what you sell", "Identifying likely buyers", "Mapping target industries and locations", "Drafting your outreach angle"];

const STEP_COPY = [
  { eyebrow: "Step 1 · Your business", title: "Tell us about your business", highlight: "your business", description: "We use this to understand what you sell and who is likely to buy it." },
  { eyebrow: "Step 2 · Ideal customers", title: "Here's who we think will buy", highlight: "will buy", description: "Generated from your profile. Edit anything — this guides discovery, scoring and pitches." },
  { eyebrow: "Step 3 · First campaign", title: "Define your first campaign", highlight: "first campaign", description: "A campaign groups a target audience with an offer and an outreach sequence." },
  { eyebrow: "Step 4 · Channels", title: "How should we reach them?", highlight: "reach them", description: "Only channels on your plan can be selected. Providers are connected in Integrations." },
  { eyebrow: "Step 5 · Automation", title: "Choose how much runs on its own", highlight: "on its own", description: "You can change this per campaign any time. Automated outreach always respects your limits and provider policies." },
  { eyebrow: "Step 6 · Review", title: "You're ready to find leads", highlight: "find leads", description: "Nothing is sent yet. Next, you'll discover leads for this campaign and review them before any outreach." },
];

// ----------------------------------------------------------------------------- Business step

interface BusinessState {
  name: string;
  website: string;
  industry: string;
  description: string;
  city: string;
  region: string;
  country: string;
  businessSize: BusinessSize;
  pricingModel: string;
  targetIndustries: string[];
  targetCustomerTypes: string[];
  outreachTone: string;
  currency: string;
  offerings: OfferingDraft[];
}

type BusinessErrors = Partial<Record<keyof BusinessState | "offerings", string>>;

function validateBusiness(state: BusinessState): BusinessErrors {
  const errors: BusinessErrors = {};
  if (state.name.trim().length < 2) errors.name = "Enter your business name";
  if (state.industry.trim().length < 2) errors.industry = "Enter your industry";
  if (state.description.trim().length < 20) errors.description = "Describe what you sell in at least a sentence (20+ characters)";
  if (!state.offerings.some((offering) => offering.name.trim().length >= 2)) errors.offerings = "Add at least one product or service";
  return errors;
}

function Card({ icon: Icon, title, hint, children, className }: { icon: React.ComponentType<{ className?: string }>; title: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border border-border bg-surface/90 p-5 shadow-xs backdrop-blur", className)}>
      <div className="mb-4 flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-soft-foreground">
          <Icon className="size-4" />
        </span>
        <div>
          <h2 className="text-[14.5px] font-semibold">{title}</h2>
          {hint ? <p className="mt-0.5 text-[12.5px] text-foreground-muted">{hint}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

const OFFERING_TYPES: Array<{ value: OfferingDraft["type"]; label: string }> = [
  { value: "SERVICE", label: "Service" },
  { value: "PRODUCT", label: "Product" },
  { value: "PACKAGE", label: "Package" },
];

function OfferingsEditor({ value, onChange, currency }: { value: OfferingDraft[]; onChange: (value: OfferingDraft[]) => void; currency: string }) {
  function update(index: number, patch: Partial<OfferingDraft>) {
    onChange(value.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }
  return (
    <div className="grid gap-3">
      <AnimatePresence initial={false}>
        {value.map((offering, index) => (
          <motion.div key={index} layout initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: -20, height: 0 }} transition={{ duration: 0.25, ease: EASE_OUT }} className="grid gap-3 rounded-xl border border-border bg-background p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <div role="radiogroup" aria-label="Type" className="inline-flex rounded-md border border-border bg-surface-muted p-0.5">
                {OFFERING_TYPES.map((type) => (
                  <button key={type.value} type="button" role="radio" aria-checked={offering.type === type.value} onClick={() => update(index, { type: type.value })} className={cn("relative rounded px-2.5 py-1 text-[12px] font-medium transition-colors", offering.type === type.value ? "text-foreground" : "text-foreground-muted hover:text-foreground")}>
                    {offering.type === type.value ? <motion.span layoutId={`offering-type-${index}`} className="absolute inset-0 rounded bg-surface shadow-xs" transition={{ type: "spring", stiffness: 500, damping: 36 }} /> : null}
                    <span className="relative">{type.label}</span>
                  </button>
                ))}
              </div>
              <span className="ml-auto text-[11px] text-foreground-subtle">#{index + 1}</span>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove" disabled={value.length === 1} onClick={() => onChange(value.filter((_, i) => i !== index))}>
                <Trash2 />
              </Button>
            </div>
            <Input placeholder="e.g. Custom branded paper cups" value={offering.name} onChange={(event) => update(index, { name: event.target.value })} aria-label="Name" className="font-medium" />
            <Input placeholder="Short description (optional)" value={offering.description} onChange={(event) => update(index, { description: event.target.value })} aria-label="Description" />
            <div className="grid grid-cols-3 gap-2">
              <Field>
                <Label className="text-xs text-foreground-muted">Price ({currency})</Label>
                <Input inputMode="decimal" placeholder="Optional" value={offering.unitPrice} onChange={(event) => update(index, { unitPrice: event.target.value.replace(/[^\d.]/g, "") })} />
              </Field>
              <Field>
                <Label className="text-xs text-foreground-muted">Per</Label>
                <Input placeholder="unit / month" value={offering.unit} onChange={(event) => update(index, { unit: event.target.value })} />
              </Field>
              <Field>
                <Label className="text-xs text-foreground-muted">Min. order</Label>
                <Input inputMode="numeric" placeholder="Optional" value={offering.minOrderQuantity} onChange={(event) => update(index, { minOrderQuantity: event.target.value.replace(/\D/g, "") })} />
              </Field>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      <button type="button" onClick={() => onChange([...value, { ...EMPTY_OFFERING }])} className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-strong py-3 text-[13px] font-medium text-foreground-secondary transition-colors hover:border-brand-1/50 hover:bg-accent-soft/30 hover:text-foreground">
        <Plus className="size-4" /> Add another product or service
      </button>
      <FieldHint>Prices are only ever used in quotes when you set them here — the AI never invents pricing.</FieldHint>
    </div>
  );
}

function DescriptionMeter({ length }: { length: number }) {
  const progress = Math.min(1, length / 20);
  const ready = length >= 20;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11.5px] tabular", ready ? "text-success-text" : "text-foreground-muted")}>
      <svg viewBox="0 0 20 20" className="size-4 -rotate-90" aria-hidden>
        <circle cx="10" cy="10" r="8" className="stroke-surface-sunken" strokeWidth="2.5" fill="none" />
        <motion.circle cx="10" cy="10" r="8" className={ready ? "stroke-good" : "stroke-brand-1"} strokeWidth="2.5" fill="none" strokeLinecap="round" initial={false} animate={{ pathLength: progress }} transition={{ duration: 0.3 }} />
      </svg>
      {ready ? "Looks good" : `${20 - length} more characters`}
    </span>
  );
}

function BusinessStep({ state, setState, errors }: { state: BusinessState; setState: React.Dispatch<React.SetStateAction<BusinessState>>; errors: BusinessErrors }) {
  const set = <K extends keyof BusinessState>(key: K, value: BusinessState[K]) => setState((current) => ({ ...current, [key]: value }));
  return (
    <div className="grid gap-4">
      <Card icon={Briefcase} title="About your business">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <Label htmlFor="name">Business name</Label>
            <Input id="name" autoFocus value={state.name} onChange={(event) => set("name", event.target.value)} aria-invalid={Boolean(errors.name)} placeholder="Acme Packaging" />
            <FieldError>{errors.name}</FieldError>
          </Field>
          <Field>
            <Label htmlFor="website">Website</Label>
            <div className="relative">
              <Globe className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-foreground-muted" />
              <Input id="website" className="pl-8" placeholder="https://" value={state.website} onChange={(event) => set("website", event.target.value)} />
            </div>
          </Field>
          <Field>
            <Label htmlFor="industry">Industry</Label>
            <Input id="industry" placeholder="e.g. Packaging manufacturing" value={state.industry} onChange={(event) => set("industry", event.target.value)} aria-invalid={Boolean(errors.industry)} />
            <FieldError>{errors.industry}</FieldError>
          </Field>
          <Field>
            <Label>Business size</Label>
            <Select value={state.businessSize} onValueChange={(value) => set("businessSize", value as BusinessSize)}>
              <SelectTrigger aria-label="Business size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUSINESS_SIZES.map((size) => (
                  <SelectItem key={size} value={size}>
                    {BUSINESS_SIZE_LABELS[size]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Card>

      <Card icon={Sparkles} title="What do you sell, and to whom?" hint="In your own words. The AI builds your ideal customer profile from this.">
        <Field>
          <Textarea
            id="description"
            aria-label="What do you sell, and to whom?"
            rows={4}
            placeholder="We manufacture custom-printed paper cups for cafés and restaurants. Minimum order 5,000 cups, full-colour branding, delivery across Delhi NCR."
            value={state.description}
            onChange={(event) => set("description", event.target.value)}
            aria-invalid={Boolean(errors.description)}
          />
          <div className="flex items-center justify-between gap-2">
            <FieldError>{errors.description}</FieldError>
            <span className="ml-auto">
              <DescriptionMeter length={state.description.trim().length} />
            </span>
          </div>
        </Field>
      </Card>

      <Card icon={Package} title="Products & services" hint="What customers can buy from you. Add as many as you like.">
        <OfferingsEditor value={state.offerings} onChange={(offerings) => set("offerings", offerings)} currency={state.currency} />
        <FieldError>{errors.offerings}</FieldError>
        <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
          <Field>
            <Label htmlFor="pricing">Pricing model</Label>
            <Input id="pricing" placeholder="e.g. Per unit with volume discounts" value={state.pricingModel} onChange={(event) => set("pricingModel", event.target.value)} />
          </Field>
          <Field>
            <Label>Currency</Label>
            <Select value={state.currency} onValueChange={(value) => set("currency", value)}>
              <SelectTrigger aria-label="Currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD"].map((code) => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Card>

      <Card icon={Users} title="Who you sell to, and where">
        <div className="grid gap-4">
          <Field>
            <Label htmlFor="target-types">Customer types</Label>
            <TagInput id="target-types" value={state.targetCustomerTypes} onChange={(value) => set("targetCustomerTypes", value)} placeholder="Cafés, restaurants, cloud kitchens…" suggestions={["Cafés", "Restaurants", "Cloud kitchens", "Bakeries", "D2C brands", "Startups", "Hotels", "Event venues"]} />
          </Field>
          <Field>
            <Label htmlFor="target-industries">Target industries (optional)</Label>
            <TagInput id="target-industries" value={state.targetIndustries} onChange={(value) => set("targetIndustries", value)} placeholder="Food & beverage, hospitality…" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <Label htmlFor="city">City</Label>
              <Input id="city" placeholder="New Delhi" value={state.city} onChange={(event) => set("city", event.target.value)} />
            </Field>
            <Field>
              <Label htmlFor="region">State / region</Label>
              <Input id="region" value={state.region} onChange={(event) => set("region", event.target.value)} />
            </Field>
            <Field>
              <Label htmlFor="country">Country</Label>
              <Input id="country" value={state.country} onChange={(event) => set("country", event.target.value)} />
            </Field>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------------------- Analysis

function AnalysisProgress() {
  const [stage, setStage] = React.useState(0);
  const reduce = useReducedMotion();
  React.useEffect(() => {
    const timer = setInterval(() => setStage((value) => Math.min(value + 1, ANALYSIS_STAGES.length - 1)), 900);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="relative isolate flex flex-col items-center overflow-hidden rounded-2xl border border-border bg-surface/90 px-6 py-14 text-center shadow-xs">
      <Aurora intensity={0.9} className="-z-10" />
      <div className="relative flex size-24 items-center justify-center">
        {reduce ? null : [0, 0.7, 1.4].map((delay) => <span key={delay} className="absolute inset-0 rounded-full border border-brand-1/40" style={{ animation: `pulse-ring 2.1s ease-out ${delay}s infinite` }} />)}
        <motion.span animate={reduce ? {} : { rotate: 360 }} transition={{ duration: 8, repeat: Infinity, ease: "linear" }} className="absolute inset-2 rounded-full border border-dashed border-brand-2/40" />
        <span className="bg-brand-gradient relative flex size-14 items-center justify-center rounded-2xl text-white shadow-[var(--brand-glow)]">
          <Sparkles className="size-6" />
        </span>
      </div>
      <p className="mt-6 text-[17px] font-semibold">Understanding your business…</p>
      <p className="mt-1 text-[13px] text-foreground-muted">This usually takes a few seconds.</p>
      <div className="mt-5 h-1 w-64 overflow-hidden rounded-full bg-surface-sunken">
        <motion.div className="bg-brand-gradient h-full rounded-full" animate={{ width: `${((stage + 1) / ANALYSIS_STAGES.length) * 100}%` }} transition={{ duration: 0.6, ease: EASE_OUT }} />
      </div>
      <ol className="mt-6 grid gap-2.5 text-left">
        {ANALYSIS_STAGES.map((label, index) => (
          <motion.li key={label} initial={{ opacity: 0, x: -8 }} animate={{ opacity: index > stage ? 0.4 : 1, x: 0 }} transition={{ delay: index * 0.05 }} className="flex items-center gap-2.5 text-[13.5px]">
            {index < stage ? (
              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 20 }} className="flex size-4 items-center justify-center rounded-full bg-good text-white">
                <Check className="size-2.5" strokeWidth={3} />
              </motion.span>
            ) : index === stage ? (
              <span className="size-4 animate-spin rounded-full border-2 border-brand-1 border-t-transparent" />
            ) : (
              <span className="size-4 rounded-full border border-border-strong" />
            )}
            {label}
          </motion.li>
        ))}
      </ol>
    </div>
  );
}

// ----------------------------------------------------------------------------- Live preview

interface PreviewProps {
  step: number;
  business: BusinessState;
  icp: Icp | null;
  campaign: CampaignState;
}

function PreviewSection({ index, step, title, icon: Icon, children }: { index: number; step: number; title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  const done = index < step;
  const active = index === step;
  return (
    <motion.div layout className={cn("relative rounded-xl border p-3.5 transition-colors", active ? "border-gradient border-transparent bg-surface shadow-[var(--brand-glow)]" : done ? "border-border bg-surface" : "border-dashed border-border bg-surface/50 opacity-70")}>
      <p className="flex items-center gap-2 text-[12px] font-semibold">
        <span className={cn("flex size-5 items-center justify-center rounded-full", done ? "bg-good text-white" : active ? "bg-brand-gradient text-white" : "bg-surface-muted text-foreground-muted")}>{done ? <Check className="size-3" strokeWidth={3} /> : <Icon className="size-3" />}</span>
        {title}
      </p>
      <div className="mt-2 text-[12.5px] text-foreground-secondary">{children}</div>
    </motion.div>
  );
}

function Chips({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <span className="text-foreground-subtle">{empty}</span>;
  return (
    <div className="flex flex-wrap gap-1">
      <AnimatePresence initial={false}>
        {items.slice(0, 6).map((item) => (
          <motion.span key={item} layout initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} className="rounded-full bg-surface-muted px-2 py-0.5 text-[11.5px]">
            {item.replace(/_/g, " ")}
          </motion.span>
        ))}
      </AnimatePresence>
      {items.length > 6 ? <span className="text-[11.5px] text-foreground-muted">+{items.length - 6}</span> : null}
    </div>
  );
}

function SetupPreview({ step, business, icp, campaign }: PreviewProps) {
  const initials = business.name.trim() ? business.name.trim().split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase() : "?";
  const services = business.offerings.map((offering) => offering.name.trim()).filter((name) => name.length >= 2);
  return (
    <aside className="hidden lg:block">
      <div className="sticky top-24 grid gap-3">
        <p className="px-1 text-[11px] font-semibold tracking-[0.12em] text-foreground-muted uppercase">Your workspace, so far</p>
        <PreviewSection index={0} step={step} title="Business" icon={Briefcase}>
          <div className="flex items-center gap-3">
            <motion.span key={initials} initial={{ scale: 0.6, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 400, damping: 18 }} className="bg-brand-gradient flex size-10 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold text-white">
              {initials}
            </motion.span>
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-semibold text-foreground">{business.name.trim() || "Your business"}</p>
              <p className="truncate text-[11.5px] text-foreground-muted">{[business.industry.trim(), business.city.trim()].filter(Boolean).join(" · ") || "Industry · city"}</p>
            </div>
          </div>
          <div className="mt-2.5">
            <Chips items={services} empty="No services yet" />
          </div>
        </PreviewSection>
        <PreviewSection index={1} step={step} title="Ideal customers" icon={Target}>
          {icp ? (
            <>
              <p className="line-clamp-3">{icp.idealCustomerProfile.description}</p>
              <div className="mt-2">
                <Chips items={icp.targetCategories} empty="" />
              </div>
            </>
          ) : (
            <Chips items={business.targetCustomerTypes} empty="Drafted by AI after step 1" />
          )}
        </PreviewSection>
        <PreviewSection index={2} step={step} title="First campaign" icon={Megaphone}>
          <p className="font-medium text-foreground">{campaign.name.trim() || "Not named yet"}</p>
          <p className="mt-0.5 flex items-center gap-1 text-[11.5px] text-foreground-muted">
            <MapPin className="size-3" /> {campaign.location || "Anywhere"} · {campaign.radiusKm} km
          </p>
        </PreviewSection>
        <PreviewSection index={3} step={step} title="Channels" icon={Mail}>
          <div className="flex flex-wrap gap-1.5">
            {campaign.channels.length ? (
              campaign.channels.map((channel) => {
                const Icon = CHANNEL_META[channel].icon;
                return (
                  <motion.span key={channel} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-[11.5px]">
                    <Icon className="size-3" /> {CHANNEL_LABELS[channel]}
                  </motion.span>
                );
              })
            ) : (
              <span className="text-foreground-subtle">None selected</span>
            )}
          </div>
        </PreviewSection>
        <PreviewSection index={4} step={step} title="Automation" icon={Bot}>
          {AUTOMATION_MODE_LABELS[campaign.automationMode].label}
        </PreviewSection>
      </div>
    </aside>
  );
}

// ----------------------------------------------------------------------------- Celebration

const CONFETTI = Array.from({ length: 36 }, (_, index) => ({
  x: ((index * 37) % 100) - 50,
  delay: (index % 9) * 0.04,
  rotate: (index * 53) % 360,
  color: ["var(--brand-1)", "var(--brand-2)", "var(--brand-3)", "var(--status-good)"][index % 4],
}));

function Celebration({ name }: { name: string }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md" role="status">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {CONFETTI.map((piece, index) => (
          <motion.span key={index} className="absolute top-1/2 left-1/2 h-3 w-1.5 rounded-sm" style={{ background: piece.color }} initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }} animate={{ x: `${piece.x}vw`, y: ["0vh", "-30vh", "60vh"], opacity: [1, 1, 0], rotate: piece.rotate * 3 }} transition={{ duration: 1.8, delay: piece.delay, ease: "easeOut" }} />
        ))}
      </div>
      <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }} className="relative text-center">
        <span className="bg-brand-gradient mx-auto flex size-16 items-center justify-center rounded-2xl text-white shadow-[var(--brand-glow)]">
          <Rocket className="size-8" />
        </span>
        <h2 className="mt-5 text-[26px] font-semibold tracking-[-0.03em]">
          {name ? `${name} is ready` : "You're all set"}
        </h2>
        <p className="mt-1 text-[14px] text-foreground-secondary">Taking you to find your first leads…</p>
      </motion.div>
    </motion.div>
  );
}

// ----------------------------------------------------------------------------- Wizard

interface CampaignState {
  name: string;
  categories: string[];
  location: string;
  radiusKm: number;
  criteria: string;
  offerSummary: string;
  channels: Channel[];
  tone: string;
  automationMode: AutomationMode;
}

function StepTitle({ step, newWorkspace, firstName }: { step: number; newWorkspace: boolean; firstName: string }) {
  const copy = STEP_COPY[step]!;
  const Icon = STEPS[step]!.icon;
  const title = step === 0 && !newWorkspace && firstName ? `Welcome, ${firstName}. ${copy.title}` : step === 0 && newWorkspace ? "Set up a new workspace" : copy.title;
  const [before, after] = title.includes(copy.highlight) ? title.split(copy.highlight) : [title, undefined];
  return (
    <div className="mb-6">
      <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-brand-1 uppercase">
        <span className="border-gradient flex size-6 items-center justify-center rounded-md bg-surface">
          <Icon className="size-3.5" />
        </span>
        {copy.eyebrow}
      </p>
      <h1 className="mt-3 text-[28px] leading-[1.1] font-semibold tracking-[-0.03em] text-balance sm:text-[34px]">
        {before}
        {after !== undefined ? <span className="text-gradient animate-gradient-pan">{copy.highlight}</span> : null}
        {after}
      </h1>
      <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-foreground-secondary">{copy.description}</p>
    </div>
  );
}

function StepRail({ step }: { step: number }) {
  return (
    <ol className="hidden items-center gap-1 md:flex" aria-label="Onboarding steps">
      {STEPS.map((item, index) => {
        const done = index < step;
        const active = index === step;
        return (
          <li key={item.label} className="flex items-center gap-1">
            <span className={cn("flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px] font-medium transition-colors", active ? "bg-foreground text-background" : done ? "text-foreground-secondary" : "text-foreground-subtle")} aria-current={active ? "step" : undefined}>
              <span className={cn("flex size-4 items-center justify-center rounded-full text-[9px]", done ? "bg-good text-white" : active ? "bg-background/20" : "border border-border-strong")}>{done ? <Check className="size-2.5" strokeWidth={3} /> : index + 1}</span>
              <span className={cn(!active && "hidden xl:inline")}>{item.label}</span>
            </span>
            {index < STEPS.length - 1 ? <span className={cn("h-px w-3 transition-colors", done ? "bg-good" : "bg-border")} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function OnboardingWizard({ initial }: { initial: OnboardingInitial }) {
  const router = useRouter();
  const [step, setStep] = React.useState(initial.profile && !initial.newWorkspace ? (initial.icp ? 2 : 1) : 0);
  const [direction, setDirection] = React.useState(1);
  // Errors appear after the first attempt to continue, then update as fields change.
  const [attempted, setAttempted] = React.useState(false);
  const [celebrating, setCelebrating] = React.useState(false);
  const [business, setBusiness] = React.useState<BusinessState>(() => ({
    name: initial.newWorkspace ? "" : (initial.profile?.name ?? ""),
    website: initial.newWorkspace ? "" : (initial.profile?.website ?? ""),
    industry: initial.newWorkspace ? "" : (initial.profile?.industry ?? ""),
    description: initial.newWorkspace ? "" : (initial.profile?.description ?? ""),
    city: initial.profile?.city ?? "",
    region: initial.profile?.region ?? "",
    country: initial.profile?.country ?? "India",
    businessSize: initial.profile?.businessSize ?? "SMALL",
    pricingModel: initial.newWorkspace ? "" : (initial.profile?.pricingModel ?? ""),
    targetIndustries: initial.newWorkspace ? [] : (initial.profile?.targetIndustries ?? []),
    targetCustomerTypes: initial.newWorkspace ? [] : (initial.profile?.targetCustomerTypes ?? []),
    outreachTone: initial.profile?.outreachTone ?? "professional",
    currency: initial.currency,
    offerings: initial.offerings.length && !initial.newWorkspace ? initial.offerings : [{ ...EMPTY_OFFERING }],
  }));
  const errors = attempted ? validateBusiness(business) : {};
  const [icp, setIcp] = React.useState<Icp | null>(initial.newWorkspace ? null : initial.icp);
  const [allowed, setAllowed] = React.useState({ modes: initial.allowedModes, channels: initial.allowedChannels, planName: initial.planName });
  const [campaign, setCampaign] = React.useState<CampaignState>(() => ({
    name: "",
    categories: initial.icp?.targetCategories.slice(0, 3) ?? [],
    location: initial.profile?.city ?? "",
    radiusKm: 25,
    criteria: "",
    offerSummary: "",
    channels: ["EMAIL"],
    tone: initial.profile?.outreachTone ?? "professional",
    automationMode: initial.allowedModes.includes("ASSISTED") ? "ASSISTED" : "MANUAL",
  }));

  const goTo = (target: number) => {
    setDirection(target > step ? 1 : -1);
    setStep(target);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveBusiness = useMutation({
    mutationFn: async () => {
      const payload = {
        newWorkspace: initial.newWorkspace,
        currency: business.currency,
        timezone: initial.timezone,
        profile: {
          name: business.name,
          website: business.website || null,
          industry: business.industry,
          description: business.description,
          city: business.city || null,
          region: business.region || null,
          country: business.country || null,
          businessSize: business.businessSize,
          pricingModel: business.pricingModel || null,
          targetIndustries: business.targetIndustries,
          targetCustomerTypes: business.targetCustomerTypes,
          outreachTone: business.outreachTone,
          preferredChannels: ["EMAIL"],
        },
        offerings: business.offerings
          .filter((offering) => offering.name.trim().length >= 2)
          .map((offering) => ({
            type: offering.type,
            name: offering.name.trim(),
            description: offering.description.trim() || null,
            unitPrice: offering.unitPrice ? Number(offering.unitPrice) : null,
            unit: offering.unit.trim() || "unit",
            currency: business.currency,
            minOrderQuantity: offering.minOrderQuantity ? Number(offering.minOrderQuantity) : null,
          })),
      };
      await api("/api/v1/onboarding/business", { method: "POST", json: payload });
      const usage = await api<{ plan: { name: string; features: { automationModes: AutomationMode[]; channels: Channel[] } } }>("/api/v1/usage");
      setAllowed({ modes: usage.plan.features.automationModes, channels: usage.plan.features.channels, planName: usage.plan.name });
    },
  });

  const analyze = useMutation({
    mutationFn: (fresh: boolean) => api<{ icp: Icp; meta: { provider: string } }>("/api/v1/business/analyze", { method: "POST", json: { fresh } }),
    onSuccess: (data) => {
      setIcp(data.icp);
      setCampaign((current) => ({
        ...current,
        categories: current.categories.length ? current.categories : data.icp.targetCategories.slice(0, 3),
        location: current.location || data.icp.recommendedLocations[0] || "",
        name: current.name || `${data.icp.recommendedLocations[0] ?? "Local"} ${data.icp.targetCategories[0]?.replace(/_/g, " ") ?? "outreach"}`.replace(/\b\w/g, (c) => c.toUpperCase()),
        offerSummary: current.offerSummary || data.icp.valueProposition,
        channels: current.channels.length ? current.channels : data.icp.suggestedChannels.filter((channel) => initial.allowedChannels.includes(channel)),
      }));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const saveIcp = useMutation({ mutationFn: (value: Icp) => api("/api/v1/business/icp", { method: "PUT", json: value }) });

  const finish = useMutation({
    mutationFn: async (withCampaign: boolean) =>
      api<{ campaignId: string | null }>("/api/v1/onboarding/complete", {
        method: "POST",
        json: {
          campaign: withCampaign
            ? {
                name: campaign.name,
                automationMode: campaign.automationMode,
                target: {
                  categories: campaign.categories,
                  keywords: icp?.leadKeywords.slice(0, 8) ?? [],
                  locations: campaign.location ? [{ label: campaign.location, city: campaign.location, lat: null, lng: null }] : [],
                  radiusKm: campaign.radiusKm,
                  criteria: campaign.criteria || null,
                  companySize: null,
                  requireWebsite: false,
                  requireContact: true,
                },
                offerSummary: campaign.offerSummary || null,
                pitchAngle: icp?.outreachAngle ?? null,
                tone: campaign.tone,
                channels: campaign.channels,
                dailyLimits: {},
                minLeadScore: 60,
              }
            : null,
        },
      }),
    onSuccess: (data) => {
      setCelebrating(true);
      window.setTimeout(() => {
        router.push(data.campaignId ? `/app/discover?campaignId=${data.campaignId}` : "/app");
        router.refresh();
      }, 1500);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  async function next() {
    if (step === 0) {
      const found = validateBusiness(business);
      setAttempted(true);
      if (Object.keys(found).length) {
        toast.error("A few details are missing", { description: Object.values(found)[0] });
        return;
      }
      try {
        await saveBusiness.mutateAsync();
        goTo(1);
        analyze.mutate(false);
      } catch (error) {
        toast.error(errorMessage(error));
      }
      return;
    }
    if (step === 1) {
      if (!icp) return;
      try {
        await saveIcp.mutateAsync(icp);
        goTo(2);
      } catch (error) {
        toast.error(errorMessage(error));
      }
      return;
    }
    if (step === 2 && campaign.name.trim().length < 2) {
      toast.error("Give your campaign a name");
      return;
    }
    if (step === 3 && campaign.channels.length === 0) {
      toast.error("Pick at least one channel");
      return;
    }
    if (step === 5) {
      finish.mutate(true);
      return;
    }
    goTo(step + 1);
  }

  const busy = saveBusiness.isPending || saveIcp.isPending || finish.isPending;
  const firstName = initial.userName.split(" ")[0] ?? "";

  return (
    <div className="relative isolate min-h-dvh overflow-x-clip">
      <Aurora intensity={0.9} className="fixed -z-10" />
      <div aria-hidden className="bg-grid fixed inset-0 -z-10 opacity-40 [mask-image:radial-gradient(ellipse_70%_50%_at_50%_0%,black,transparent)]" />
      <header className="sticky top-0 z-20 border-b border-border bg-background/75 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <StepRail step={step} />
          <p className="text-xs font-medium text-foreground-muted tabular md:hidden">
            Step {step + 1} of {STEPS.length}
          </p>
        </div>
        <div className="h-0.5 bg-transparent">
          <motion.div className="bg-brand-gradient h-full" initial={false} animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }} transition={{ duration: 0.6, ease: EASE_OUT }} />
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 sm:py-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <main className="min-w-0">
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div key={step} custom={direction} initial={{ opacity: 0, x: direction * 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: direction * -40 }} transition={{ duration: 0.35, ease: EASE_OUT }}>
              <StepTitle step={step} newWorkspace={initial.newWorkspace} firstName={firstName} />

              {step === 0 ? <BusinessStep state={business} setState={setBusiness} errors={errors} /> : null}

              {step === 1 ? (
                analyze.isPending ? (
                  <AnalysisProgress />
                ) : analyze.isError && !icp ? (
                  <Callout
                    tone="danger"
                    title="AI analysis failed"
                    action={
                      <Button size="sm" onClick={() => analyze.mutate(true)}>
                        <RefreshCw /> Retry
                      </Button>
                    }
                  >
                    {analyze.error instanceof ApiError && analyze.error.code === "PROVIDER_NOT_CONFIGURED" ? "No AI provider is configured. An admin can connect one in Integrations." : errorMessage(analyze.error)}
                  </Callout>
                ) : icp ? (
                  <>
                    <div className="mb-3 flex justify-end">
                      <Button variant="secondary" size="sm" onClick={() => analyze.mutate(true)}>
                        <RefreshCw /> Regenerate
                      </Button>
                    </div>
                    <IcpEditor icp={icp} onChange={setIcp} />
                  </>
                ) : (
                  <div className="flex justify-center rounded-2xl border border-dashed border-border-strong py-14">
                    <Button variant="primary" size="lg" onClick={() => analyze.mutate(false)} className="shadow-[var(--brand-glow)]">
                      <Sparkles /> Analyse my business
                    </Button>
                  </div>
                )
              ) : null}

              {step === 2 ? (
                <div className="grid gap-4">
                  <Card icon={Megaphone} title="Name and audience">
                    <div className="grid gap-4">
                      <Field>
                        <Label htmlFor="campaign-name">Campaign name</Label>
                        <Input id="campaign-name" placeholder="Delhi Cafe Outreach" value={campaign.name} onChange={(event) => setCampaign({ ...campaign, name: event.target.value })} />
                      </Field>
                      <Field>
                        <Label>Target businesses</Label>
                        <TagInput value={campaign.categories} onChange={(categories) => setCampaign({ ...campaign, categories })} suggestions={icp?.targetCategories ?? []} placeholder="cafe, restaurant…" />
                      </Field>
                      <Field>
                        <Label htmlFor="criteria">Lead criteria</Label>
                        <Input id="criteria" placeholder="Independent cafés with 2+ locations" value={campaign.criteria} onChange={(event) => setCampaign({ ...campaign, criteria: event.target.value })} />
                      </Field>
                    </div>
                  </Card>
                  <Card icon={MapPin} title="Where">
                    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
                      <Field>
                        <Label htmlFor="location">Location</Label>
                        <Input id="location" placeholder="Delhi NCR" value={campaign.location} onChange={(event) => setCampaign({ ...campaign, location: event.target.value })} />
                        {icp?.recommendedLocations.length ? (
                          <div className="flex flex-wrap gap-1.5">
                            {icp.recommendedLocations.map((location) => (
                              <button key={location} type="button" onClick={() => setCampaign({ ...campaign, location })} className={cn("rounded-full border px-2.5 py-0.5 text-xs transition-colors", campaign.location === location ? "border-transparent bg-foreground text-background" : "border-dashed border-border-strong text-foreground-muted hover:text-foreground")}>
                                {location}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </Field>
                      <Field>
                        <Label>Radius</Label>
                        <Select value={String(campaign.radiusKm)} onValueChange={(value) => setCampaign({ ...campaign, radiusKm: Number(value) })}>
                          <SelectTrigger aria-label="Radius">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[5, 10, 25, 50, 100].map((km) => (
                              <SelectItem key={km} value={String(km)}>
                                {km} km
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                  </Card>
                  <Card icon={Sparkles} title="Your offer" hint="What this campaign pitches. Outreach is written around it.">
                    <Textarea id="offer" aria-label="Offer" rows={3} placeholder="Custom branded cups, MOQ 5,000" value={campaign.offerSummary} onChange={(event) => setCampaign({ ...campaign, offerSummary: event.target.value })} />
                  </Card>
                </div>
              ) : null}

              {step === 3 ? (
                <div className="grid gap-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(["EMAIL", "WHATSAPP", "VOICE", "MANUAL_CALL"] as Channel[]).map((channel, index) => {
                      const { icon: Icon, description } = CHANNEL_META[channel];
                      const available = allowed.channels.includes(channel);
                      const selected = campaign.channels.includes(channel);
                      return (
                        <motion.button
                          key={channel}
                          type="button"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.06 }}
                          whileHover={available ? { y: -2 } : undefined}
                          whileTap={available ? { scale: 0.98 } : undefined}
                          disabled={!available}
                          aria-pressed={selected}
                          onClick={() => setCampaign({ ...campaign, channels: selected ? campaign.channels.filter((item) => item !== channel) : [...campaign.channels, channel] })}
                          className={cn("relative flex items-start gap-3 rounded-2xl border bg-surface p-4 text-left transition-shadow", selected ? "border-gradient border-transparent shadow-[var(--brand-glow)]" : "border-border hover:shadow-md", !available && "cursor-not-allowed opacity-55")}
                        >
                          <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors", selected ? "bg-brand-gradient text-white" : "bg-surface-muted text-foreground-secondary")}>
                            <Icon className="size-5" />
                          </span>
                          <span className="flex-1">
                            <span className="flex items-center gap-2 text-[14px] font-semibold">
                              {CHANNEL_LABELS[channel]}
                              {!available ? (
                                <Badge tone="outline">
                                  <Lock /> Upgrade
                                </Badge>
                              ) : null}
                            </span>
                            <span className="mt-1 block text-[12.5px] leading-snug text-foreground-muted">{description}</span>
                          </span>
                          <AnimatePresence>
                            {selected ? (
                              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: "spring", stiffness: 500, damping: 22 }} className="flex size-5 items-center justify-center rounded-full bg-good text-white">
                                <Check className="size-3" strokeWidth={3} />
                              </motion.span>
                            ) : null}
                          </AnimatePresence>
                        </motion.button>
                      );
                    })}
                  </div>
                  <Card icon={MessageCircle} title="Tone of voice">
                    <div role="radiogroup" aria-label="Outreach tone" className="flex flex-wrap gap-2">
                      {TONES.map((tone) => (
                        <button key={tone.value} type="button" role="radio" aria-checked={campaign.tone === tone.value} onClick={() => setCampaign({ ...campaign, tone: tone.value })} className={cn("relative rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors", campaign.tone === tone.value ? "border-transparent text-background" : "border-border text-foreground-secondary hover:text-foreground")}>
                          {campaign.tone === tone.value ? <motion.span layoutId="onboarding-tone" className="absolute inset-0 rounded-full bg-foreground" transition={{ type: "spring", stiffness: 500, damping: 36 }} /> : null}
                          <span className="relative">{tone.label}</span>
                        </button>
                      ))}
                    </div>
                  </Card>
                </div>
              ) : null}

              {step === 4 ? (
                <div role="radiogroup" aria-label="Automation level" className="grid gap-3 md:grid-cols-3">
                  {(["MANUAL", "ASSISTED", "AUTOMATED"] as AutomationMode[]).map((mode, index) => {
                    const { icon: Icon, flow } = MODE_META[mode];
                    const available = allowed.modes.includes(mode);
                    const selected = campaign.automationMode === mode;
                    return (
                      <motion.button
                        key={mode}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={!available}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.08 }}
                        whileHover={available ? { y: -3 } : undefined}
                        onClick={() => setCampaign({ ...campaign, automationMode: mode })}
                        className={cn("relative flex h-full flex-col rounded-2xl border bg-surface p-5 text-left transition-shadow", selected ? "border-gradient border-transparent shadow-[var(--brand-glow)]" : "border-border hover:shadow-md", !available && "cursor-not-allowed opacity-55")}
                      >
                        {mode === "ASSISTED" ? <span className="bg-brand-gradient absolute -top-2.5 left-5 rounded-full px-2 py-0.5 text-[10.5px] font-semibold text-white">Recommended</span> : null}
                        <span className={cn("flex size-11 items-center justify-center rounded-xl transition-colors", selected ? "bg-brand-gradient text-white" : "bg-surface-muted text-foreground-secondary")}>
                          <Icon className="size-5" />
                        </span>
                        <span className="mt-4 text-[15px] font-semibold">{AUTOMATION_MODE_LABELS[mode].label}</span>
                        <span className="mt-1 text-[12.5px] leading-snug text-foreground-muted">{AUTOMATION_MODE_LABELS[mode].description}</span>
                        <span className="mt-4 flex flex-wrap items-center gap-1 text-[11px] font-medium text-foreground-secondary">
                          {flow.map((item, flowIndex) => (
                            <React.Fragment key={item}>
                              {flowIndex > 0 ? <ArrowRight className="size-3 text-foreground-subtle" /> : null}
                              <span className="rounded-full bg-surface-muted px-2 py-0.5">{item}</span>
                            </React.Fragment>
                          ))}
                        </span>
                        {!available ? (
                          <span className="mt-3 inline-flex items-center gap-1 text-[11.5px] text-foreground-muted">
                            <Lock className="size-3" /> Not on {allowed.planName}
                          </span>
                        ) : null}
                      </motion.button>
                    );
                  })}
                </div>
              ) : null}

              {step === 5 ? (
                <div className="grid gap-4">
                  <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-xs">
                    {[
                      { icon: Briefcase, label: "Business", value: `${business.name} — ${business.industry}` },
                      { icon: Package, label: "Sells", value: business.offerings.filter((o) => o.name).map((o) => o.name).join(", ") },
                      { icon: Megaphone, label: "Campaign", value: campaign.name },
                      { icon: Target, label: "Targets", value: `${campaign.categories.map((item) => item.replace(/_/g, " ")).join(", ") || "—"} in ${campaign.location || "—"} (${campaign.radiusKm} km)` },
                      { icon: Mail, label: "Channels", value: campaign.channels.map((channel) => CHANNEL_LABELS[channel]).join(", ") },
                      { icon: Bot, label: "Automation", value: AUTOMATION_MODE_LABELS[campaign.automationMode].label },
                    ].map((row, index) => (
                      <motion.div key={row.label} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.06 }} className="grid grid-cols-[28px_110px_minmax(0,1fr)] items-center gap-3 border-b border-border px-5 py-3 text-[13.5px] last:border-0">
                        <row.icon className="size-4 text-brand-1" />
                        <span className="text-foreground-muted">{row.label}</span>
                        <span className="truncate font-medium">{row.value}</span>
                      </motion.div>
                    ))}
                  </div>
                  <Card icon={Rocket} title="What happens next">
                    <ol className="grid gap-3 sm:grid-cols-3">
                      {[
                        { icon: Telescope, title: "Discover", body: "We search for businesses that match this campaign." },
                        { icon: Radar, title: "Review", body: "You check the scored leads and pick who to contact." },
                        { icon: ShieldCheck, title: "Launch", body: "You see volume, AI usage and cost, then confirm." },
                      ].map((item, index) => (
                        <motion.li key={item.title} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + index * 0.1 }} className="rounded-xl bg-surface-muted/60 p-3">
                          <item.icon className="size-4 text-brand-1" />
                          <p className="mt-2 text-[13px] font-semibold">{item.title}</p>
                          <p className="mt-0.5 text-[12px] leading-snug text-foreground-muted">{item.body}</p>
                        </motion.li>
                      ))}
                    </ol>
                  </Card>
                  <p className="flex items-center gap-1.5 text-[12.5px] text-foreground-muted">
                    <CheckCircle2 className="size-4 text-good" /> The campaign is saved as a draft. Nothing is sent until you launch it.
                  </p>
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>

          <div className="sticky bottom-0 z-10 -mx-4 mt-8 border-t border-border bg-background/80 px-4 py-4 backdrop-blur-xl sm:mx-0 sm:rounded-2xl sm:border sm:px-5">
            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" onClick={() => goTo(Math.max(0, step - 1))} disabled={step === 0 || busy}>
                <ArrowLeft /> Back
              </Button>
              <div className="flex items-center gap-2">
                {step >= 2 ? (
                  <Button variant="ghost" onClick={() => finish.mutate(false)} disabled={busy}>
                    Skip for now
                  </Button>
                ) : null}
                <Button variant="primary" size="lg" onClick={next} loading={busy} disabled={step === 1 && (!icp || analyze.isPending)} className="relative overflow-hidden px-5 shadow-[var(--brand-glow)]">
                  {step === 5 ? (
                    <>
                      <Rocket /> Finish & find leads
                    </>
                  ) : (
                    <>
                      Continue <ArrowRight />
                    </>
                  )}
                  <span aria-hidden className="absolute inset-y-0 left-0 w-10 bg-white/25 blur-md" style={{ animation: "sheen 3.2s ease-in-out infinite" }} />
                </Button>
              </div>
            </div>
          </div>
        </main>

        <SetupPreview step={step} business={business} icp={icp} campaign={campaign} />
      </div>
      <AnimatePresence>{celebrating ? <Celebration name={business.name.trim()} /> : null}</AnimatePresence>
    </div>
  );
}
