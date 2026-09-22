"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, RefreshCw, Sparkles, Target } from "lucide-react";
import { motion } from "motion/react";
import { BUSINESS_SIZE_LABELS, BUSINESS_SIZES, CHANNEL_LABELS, CHANNELS, type BusinessSize, type Channel } from "@repo/config";
import type { Icp } from "@repo/core/business/schemas";
import { AnimatedNumber, Aurora, Button, ErrorState, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, Spinner, Textarea, cn, toast } from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { CatalogTab } from "../crm/catalog-tab";
import { TagInput } from "../forms/tag-input";
import { IcpEditor } from "../onboarding/onboarding-wizard";
import { useCanManage } from "../shell/shell-context";
import { ReadOnlyNotice, Row, SaveBar, Section } from "./kit";

interface Profile {
  id: string;
  name: string;
  website: string | null;
  industry: string;
  description: string;
  city: string | null;
  region: string | null;
  country: string | null;
  businessSize: BusinessSize;
  pricingModel: string | null;
  targetIndustries: string[];
  targetCustomerTypes: string[];
  valueProposition: string | null;
  outreachTone: string;
  preferredChannels: Channel[];
  icp: Icp | null;
  aiAnalyzedAt: string | null;
}

const TONES = [
  { value: "professional", label: "Professional" },
  { value: "friendly", label: "Friendly" },
  { value: "concise", label: "Short & direct" },
  { value: "consultative", label: "Consultative" },
];

type Form = Omit<Profile, "id" | "icp" | "aiAnalyzedAt" | "website" | "city" | "region" | "country" | "pricingModel" | "valueProposition"> & { website: string; city: string; region: string; country: string; pricingModel: string; valueProposition: string };

function toForm(profile: Profile): Form {
  return {
    name: profile.name,
    website: profile.website ?? "",
    industry: profile.industry,
    description: profile.description,
    city: profile.city ?? "",
    region: profile.region ?? "",
    country: profile.country ?? "",
    businessSize: profile.businessSize,
    pricingModel: profile.pricingModel ?? "",
    targetIndustries: profile.targetIndustries,
    targetCustomerTypes: profile.targetCustomerTypes,
    valueProposition: profile.valueProposition ?? "",
    outreachTone: profile.outreachTone,
    preferredChannels: profile.preferredChannels,
  };
}

function Overview({ profile, services }: { profile: Profile; services: number }) {
  const stats = [
    { label: "services & products", value: services },
    { label: "categories to target", value: profile.icp?.targetCategories.length ?? 0 },
    { label: "target industries", value: profile.targetIndustries.length },
  ];
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="relative isolate overflow-hidden rounded-xl border border-border bg-surface p-5 shadow-xs sm:p-6">
      <Aurora intensity={0.7} className="-z-10" />
      <p className="text-xs font-semibold tracking-[0.12em] text-brand-1 uppercase">How we understand {profile.name}</p>
      <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-foreground">{profile.icp?.summary ?? profile.description}</p>
      <div className="mt-5 flex flex-wrap gap-6">
        {stats.map((stat) => (
          <div key={stat.label}>
            <p className="text-gradient text-[28px] leading-none font-semibold tracking-[-0.03em] tabular">
              <AnimatedNumber value={stat.value} />
            </p>
            <p className="mt-1 text-[12px] text-foreground-muted">{stat.label}</p>
          </div>
        ))}
      </div>
    </motion.section>
  );
}

function ProfileForm({ profile }: { profile: Profile }) {
  const queryClient = useQueryClient();
  const canManage = useCanManage();
  const initial = toForm(profile);
  const [form, setForm] = React.useState<Form>(initial);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));
  const save = useMutation({
    mutationFn: () => api<Profile>("/api/v1/business/profile", { method: "PUT", json: { ...form, website: form.website || null, city: form.city || null, region: form.region || null, country: form.country || null, pricingModel: form.pricingModel || null, valueProposition: form.valueProposition || null } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["business-profile"], updated);
      toast.success("Business profile saved", { description: "Re-run the AI analysis to refresh your ideal customer profile." });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const disabled = !canManage;
  return (
    <Section id="profile" title="Business profile" description="What you sell and how you talk about it. Outreach and scoring read from here." icon={Briefcase} footer={canManage ? <SaveBar dirty={dirty} pending={save.isPending} onSave={() => save.mutate()} onReset={() => setForm(initial)} disabled={form.description.trim().length < 20 || form.name.trim().length < 2} /> : null}>
      {canManage ? null : <ReadOnlyNotice what="the business profile" />}
      <Row label="Business name" htmlFor="biz-name">
        <Input id="biz-name" value={form.name} disabled={disabled} onChange={(event) => set("name", event.target.value)} />
      </Row>
      <Row label="Website" hint="Used to understand what you do." htmlFor="biz-website">
        <Input id="biz-website" value={form.website} placeholder="https://" disabled={disabled} onChange={(event) => set("website", event.target.value)} />
      </Row>
      <Row label="Industry and size">
        <div className="grid gap-2 sm:grid-cols-2">
          <Input aria-label="Industry" value={form.industry} disabled={disabled} onChange={(event) => set("industry", event.target.value)} />
          <Select value={form.businessSize} onValueChange={(value) => set("businessSize", value as BusinessSize)} disabled={disabled}>
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
        </div>
      </Row>
      <Row label="What you sell" hint="A few sentences in your own words." htmlFor="biz-description">
        <Textarea id="biz-description" rows={4} value={form.description} disabled={disabled} onChange={(event) => set("description", event.target.value)} />
        <p className={cn("mt-1 text-right text-[11.5px]", form.description.trim().length < 20 ? "text-warning-text" : "text-foreground-muted")}>{form.description.trim().length < 20 ? "At least 20 characters" : `${form.description.length} characters`}</p>
      </Row>
      <Row label="Why customers pick you" hint="Your value proposition — outreach leans on it." htmlFor="biz-value">
        <Textarea id="biz-value" rows={2} value={form.valueProposition} disabled={disabled} onChange={(event) => set("valueProposition", event.target.value)} />
      </Row>
      <Row label="Where you're based">
        <div className="grid gap-2 sm:grid-cols-3">
          <Input aria-label="City" placeholder="City" value={form.city} disabled={disabled} onChange={(event) => set("city", event.target.value)} />
          <Input aria-label="Region" placeholder="State / region" value={form.region} disabled={disabled} onChange={(event) => set("region", event.target.value)} />
          <Input aria-label="Country" placeholder="Country" value={form.country} disabled={disabled} onChange={(event) => set("country", event.target.value)} />
        </div>
      </Row>
      <Row label="Who you sell to" hint="Industries and customer types. Press Enter after each.">
        <div className="grid gap-2">
          <TagInput value={form.targetIndustries} onChange={(value) => set("targetIndustries", value)} placeholder="Add an industry" />
          <TagInput value={form.targetCustomerTypes} onChange={(value) => set("targetCustomerTypes", value)} placeholder="Add a customer type" />
        </div>
      </Row>
      <Row label="Pricing model" hint="E.g. monthly retainer, per project, per unit." htmlFor="biz-pricing">
        <Input id="biz-pricing" value={form.pricingModel} disabled={disabled} onChange={(event) => set("pricingModel", event.target.value)} />
      </Row>
      <Row label="Tone of voice">
        <div role="radiogroup" aria-label="Tone of voice" className="flex flex-wrap gap-2">
          {TONES.map((tone) => (
            <button key={tone.value} type="button" role="radio" aria-checked={form.outreachTone === tone.value} disabled={disabled} onClick={() => set("outreachTone", tone.value)} className={cn("rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors", form.outreachTone === tone.value ? "border-transparent bg-foreground text-background" : "border-border text-foreground-secondary hover:text-foreground")}>
              {tone.label}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Preferred channels">
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map((channel) => {
            const on = form.preferredChannels.includes(channel);
            return (
              <button key={channel} type="button" aria-pressed={on} disabled={disabled} onClick={() => set("preferredChannels", on ? form.preferredChannels.filter((item) => item !== channel) : [...form.preferredChannels, channel])} className={cn("rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors", on ? "border-transparent bg-accent-soft text-accent-soft-foreground" : "border-border text-foreground-secondary hover:text-foreground")}>
                {CHANNEL_LABELS[channel]}
              </button>
            );
          })}
        </div>
      </Row>
    </Section>
  );
}

function IcpSection({ profile }: { profile: Profile }) {
  const queryClient = useQueryClient();
  const canManage = useCanManage();
  const [icp, setIcp] = React.useState<Icp | null>(profile.icp);
  const dirty = JSON.stringify(icp) !== JSON.stringify(profile.icp);
  const save = useMutation({
    mutationFn: () => api<{ icp: Icp }>("/api/v1/business/icp", { method: "PUT", json: icp }),
    onSuccess: (result) => {
      queryClient.setQueryData<Profile>(["business-profile"], (current) => (current ? { ...current, icp: result.icp } : current));
      toast.success("Ideal customer profile saved");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const analyse = useMutation({
    mutationFn: () => api<{ icp: Icp }>("/api/v1/business/analyze", { method: "POST", json: { fresh: true } }),
    onSuccess: (result) => {
      setIcp(result.icp);
      queryClient.setQueryData<Profile>(["business-profile"], (current) => (current ? { ...current, icp: result.icp, aiAnalyzedAt: new Date().toISOString() } : current));
      toast.success("Analysis refreshed");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Section
      id="icp"
      title="Ideal customer profile"
      description={profile.aiAnalyzedAt ? `Drafted by AI from your profile and services on ${new Date(profile.aiAnalyzedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}. Edit anything — discovery and scoring use it.` : "Drafted by AI from your profile and services. Edit anything — discovery and scoring use it."}
      icon={Target}
      footer={
        canManage ? (
          <>
            <Button variant="secondary" size="sm" className="mr-auto" disabled={analyse.isPending} onClick={() => analyse.mutate()}>
              {analyse.isPending ? <Spinner className="size-3.5" /> : <RefreshCw />} Re-analyse with AI
            </Button>
            <SaveBar dirty={dirty} pending={save.isPending} onSave={() => save.mutate()} onReset={() => setIcp(profile.icp)} disabled={!icp} />
          </>
        ) : null
      }
    >
      {analyse.isPending ? (
        <div className="flex items-center gap-3 rounded-lg bg-accent-soft px-4 py-3 text-[13px] text-accent-soft-foreground">
          <Sparkles className="size-4 animate-pulse" /> Reading your profile and services…
        </div>
      ) : icp ? (
        <IcpEditor icp={icp} onChange={setIcp} />
      ) : (
        <p className="text-[13px] text-foreground-secondary">No profile yet. Run the AI analysis to draft one.</p>
      )}
    </Section>
  );
}

export function BusinessSettings() {
  const profile = useQuery({ queryKey: ["business-profile"], queryFn: () => api<Profile | null>("/api/v1/business/profile") });
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: () => api<{ offerings: unknown[] }>("/api/v1/catalog") });
  if (profile.isError) return <ErrorState description={errorMessage(profile.error)} onRetry={() => void profile.refetch()} />;
  if (profile.isPending) return <Skeleton className="h-96 rounded-xl" />;
  if (!profile.data) return <ErrorState title="No business profile yet" description="Finish onboarding to set one up." />;
  return (
    <>
      <Overview profile={profile.data} services={catalog.data?.offerings.length ?? 0} />
      <section id="services" aria-label="Services and products" className="scroll-mt-24 rounded-xl border border-border bg-surface p-5 shadow-xs">
        <CatalogTab />
      </section>
      <ProfileForm key={profile.data.id} profile={profile.data} />
      <IcpSection key={`${profile.data.id}-icp`} profile={profile.data} />
    </>
  );
}
