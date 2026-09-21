"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Hand,
  Loader2,
  Lock,
  Mail,
  MessageCircle,
  Phone,
  PhoneCall,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import {
  AUTOMATION_MODE_LABELS,
  BUSINESS_SIZE_LABELS,
  BUSINESS_SIZES,
  CHANNEL_LABELS,
  type AutomationMode,
  type BusinessSize,
  type Channel,
} from "@repo/config";
import type { Icp } from "@repo/core/business/schemas";
import {
  Badge,
  Button,
  Callout,
  Field,
  FieldError,
  FieldHint,
  Input,
  Label,
  RadioCard,
  RadioGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  cn,
  toast,
} from "@repo/ui";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { Logo } from "../brand/logo";
import { TagInput } from "../forms/tag-input";

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

const STEPS = ["Business", "AI analysis", "First campaign", "Channels", "Automation", "Review"] as const;

const EMPTY_OFFERING: OfferingDraft = { type: "SERVICE", name: "", description: "", unitPrice: "", unit: "unit", minOrderQuantity: "" };

const TONES = [
  { value: "professional", label: "Professional" },
  { value: "friendly", label: "Friendly" },
  { value: "concise", label: "Short & direct" },
  { value: "consultative", label: "Consultative" },
];

const CHANNEL_ICONS: Record<Channel, React.ComponentType<{ className?: string }>> = {
  EMAIL: Mail,
  WHATSAPP: MessageCircle,
  VOICE: PhoneCall,
  MANUAL_CALL: Phone,
};

const MODE_ICONS: Record<AutomationMode, React.ComponentType<{ className?: string }>> = {
  MANUAL: Hand,
  ASSISTED: Bot,
  AUTOMATED: Zap,
};

const ANALYSIS_STAGES = [
  "Reading your business profile",
  "Understanding what you sell",
  "Identifying likely buyers",
  "Mapping target industries and locations",
  "Drafting your outreach angle",
];

// ----------------------------------------------------------------------------- Step: Business

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

function OfferingsEditor({ value, onChange, currency }: { value: OfferingDraft[]; onChange: (value: OfferingDraft[]) => void; currency: string }) {
  function update(index: number, patch: Partial<OfferingDraft>) {
    onChange(value.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }
  return (
    <div className="grid gap-2">
      {value.map((offering, index) => (
        <div key={index} className="grid gap-2 rounded-lg border border-border bg-surface p-3">
          <div className="grid gap-2 sm:grid-cols-[120px_1fr_auto]">
            <Select value={offering.type} onValueChange={(type) => update(index, { type: type as OfferingDraft["type"] })}>
              <SelectTrigger aria-label="Type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SERVICE">Service</SelectItem>
                <SelectItem value="PRODUCT">Product</SelectItem>
                <SelectItem value="PACKAGE">Package</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="e.g. Custom branded paper cups" value={offering.name} onChange={(event) => update(index, { name: event.target.value })} aria-label="Name" />
            <Button type="button" variant="ghost" size="icon" aria-label="Remove" disabled={value.length === 1} onClick={() => onChange(value.filter((_, i) => i !== index))}>
              <Trash2 />
            </Button>
          </div>
          <Input placeholder="Short description (optional)" value={offering.description} onChange={(event) => update(index, { description: event.target.value })} aria-label="Description" />
          <div className="grid grid-cols-3 gap-2">
            <Field>
              <Label className="text-xs text-foreground-muted">Price ({currency}, optional)</Label>
              <Input inputMode="decimal" placeholder="—" value={offering.unitPrice} onChange={(event) => update(index, { unitPrice: event.target.value.replace(/[^\d.]/g, "") })} />
            </Field>
            <Field>
              <Label className="text-xs text-foreground-muted">Per</Label>
              <Input placeholder="unit / month / project" value={offering.unit} onChange={(event) => update(index, { unit: event.target.value })} />
            </Field>
            <Field>
              <Label className="text-xs text-foreground-muted">Min. order</Label>
              <Input inputMode="numeric" placeholder="—" value={offering.minOrderQuantity} onChange={(event) => update(index, { minOrderQuantity: event.target.value.replace(/\D/g, "") })} />
            </Field>
          </div>
        </div>
      ))}
      <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => onChange([...value, { ...EMPTY_OFFERING }])}>
        <Plus /> Add another
      </Button>
      <FieldHint>Prices are only ever used in quotes when you set them here — the AI never invents pricing.</FieldHint>
    </div>
  );
}

function BusinessStep({ state, setState, errors }: { state: BusinessState; setState: React.Dispatch<React.SetStateAction<BusinessState>>; errors: BusinessErrors }) {
  const set = <K extends keyof BusinessState>(key: K, value: BusinessState[K]) => setState((current) => ({ ...current, [key]: value }));
  return (
    <div className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <Label htmlFor="name">Business name</Label>
          <Input id="name" value={state.name} onChange={(event) => set("name", event.target.value)} aria-invalid={Boolean(errors.name)} />
          <FieldError>{errors.name}</FieldError>
        </Field>
        <Field>
          <Label htmlFor="website">Website</Label>
          <Input id="website" placeholder="https://" value={state.website} onChange={(event) => set("website", event.target.value)} />
        </Field>
        <Field>
          <Label htmlFor="industry">Industry</Label>
          <Input id="industry" placeholder="e.g. Packaging manufacturing" value={state.industry} onChange={(event) => set("industry", event.target.value)} aria-invalid={Boolean(errors.industry)} />
          <FieldError>{errors.industry}</FieldError>
        </Field>
        <Field>
          <Label>Business size</Label>
          <Select value={state.businessSize} onValueChange={(value) => set("businessSize", value as BusinessSize)}>
            <SelectTrigger>
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
      <Field>
        <Label htmlFor="description">What do you sell, and to whom?</Label>
        <Textarea
          id="description"
          rows={4}
          placeholder="We manufacture custom-printed paper cups for cafés and restaurants. Minimum order 5,000 cups, full-colour branding, delivery across Delhi NCR."
          value={state.description}
          onChange={(event) => set("description", event.target.value)}
          aria-invalid={Boolean(errors.description)}
        />
        <FieldError>{errors.description}</FieldError>
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
      <Field>
        <Label>Products & services</Label>
        <OfferingsEditor value={state.offerings} onChange={(offerings) => set("offerings", offerings)} currency={state.currency} />
        <FieldError>{errors.offerings}</FieldError>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <Label htmlFor="pricing">Pricing model</Label>
          <Input id="pricing" placeholder="e.g. Per unit with volume discounts" value={state.pricingModel} onChange={(event) => set("pricingModel", event.target.value)} />
        </Field>
        <Field>
          <Label>Currency</Label>
          <Select value={state.currency} onValueChange={(value) => set("currency", value)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["INR", "USD", "EUR", "GBP", "AED", "SGD"].map((code) => (
                <SelectItem key={code} value={code}>
                  {code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field>
        <Label htmlFor="target-types">Who do you want to sell to?</Label>
        <TagInput
          id="target-types"
          value={state.targetCustomerTypes}
          onChange={(value) => set("targetCustomerTypes", value)}
          placeholder="Cafés, restaurants, cloud kitchens…"
          suggestions={["Cafés", "Restaurants", "Cloud kitchens", "Bakeries", "D2C brands", "Startups", "Hotels", "Event venues"]}
        />
      </Field>
      <Field>
        <Label htmlFor="target-industries">Target industries (optional)</Label>
        <TagInput id="target-industries" value={state.targetIndustries} onChange={(value) => set("targetIndustries", value)} placeholder="Food & beverage, hospitality…" />
      </Field>
    </div>
  );
}

// ----------------------------------------------------------------------------- Step: Analysis

function AnalysisProgress() {
  const [stage, setStage] = React.useState(0);
  React.useEffect(() => {
    const timer = setInterval(() => setStage((value) => Math.min(value + 1, ANALYSIS_STAGES.length - 1)), 900);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex flex-col items-center py-12 text-center">
      <div className="flex size-11 items-center justify-center rounded-xl bg-accent-soft">
        <Sparkles className="size-5 animate-pulse text-accent-soft-foreground" />
      </div>
      <p className="mt-4 text-sm font-medium">Understanding your business…</p>
      <ol className="mt-5 grid gap-2 text-left">
        {ANALYSIS_STAGES.map((label, index) => (
          <li key={label} className={cn("flex items-center gap-2 text-[13px] transition-opacity", index > stage ? "opacity-35" : "opacity-100")}>
            {index < stage ? (
              <Check className="size-3.5 text-success-text" />
            ) : index === stage ? (
              <Loader2 className="size-3.5 animate-spin text-foreground-muted" />
            ) : (
              <span className="size-3.5 rounded-full border border-border-strong" />
            )}
            {label}
          </li>
        ))}
      </ol>
    </div>
  );
}

function IcpEditor({ icp, onChange }: { icp: Icp; onChange: (icp: Icp) => void }) {
  const set = <K extends keyof Icp>(key: K, value: Icp[K]) => onChange({ ...icp, [key]: value });
  return (
    <div className="grid gap-5">
      <Callout tone="accent" icon={Sparkles} title="Here's how we understand your business">
        {icp.summary}
      </Callout>
      <Field>
        <Label>Ideal customer</Label>
        <Textarea
          rows={2}
          value={icp.idealCustomerProfile.description}
          onChange={(event) => set("idealCustomerProfile", { ...icp.idealCustomerProfile, description: event.target.value })}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <Label>Business categories to target</Label>
          <TagInput value={icp.targetCategories} onChange={(value) => set("targetCategories", value)} />
          <FieldHint>Used as search categories when discovering leads.</FieldHint>
        </Field>
        <Field>
          <Label>Recommended locations</Label>
          <TagInput value={icp.recommendedLocations} onChange={(value) => set("recommendedLocations", value)} />
        </Field>
        <Field>
          <Label>Target industries</Label>
          <TagInput value={icp.targetIndustries} onChange={(value) => set("targetIndustries", value)} />
        </Field>
        <Field>
          <Label>Lead keywords</Label>
          <TagInput value={icp.leadKeywords} onChange={(value) => set("leadKeywords", value)} />
        </Field>
      </div>
      <Field>
        <Label>Must-haves</Label>
        <TagInput
          value={icp.idealCustomerProfile.mustHaves}
          onChange={(value) => set("idealCustomerProfile", { ...icp.idealCustomerProfile, mustHaves: value })}
        />
      </Field>
      <Field>
        <Label>Buyer personas</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {icp.buyerPersonas.map((persona, index) => (
            <div key={index} className="rounded-lg border border-border bg-surface p-3">
              <Input
                value={persona.title}
                onChange={(event) =>
                  set(
                    "buyerPersonas",
                    icp.buyerPersonas.map((p, i) => (i === index ? { ...p, title: event.target.value } : p)),
                  )
                }
                className="font-medium"
              />
              <p className="mt-2 text-xs text-foreground-muted">Goals</p>
              <p className="text-[13px] text-foreground-secondary">{persona.goals.join(" · ")}</p>
              <p className="mt-2 text-xs text-foreground-muted">Pain points</p>
              <p className="text-[13px] text-foreground-secondary">{persona.painPoints.join(" · ")}</p>
            </div>
          ))}
        </div>
      </Field>
      <Field>
        <Label>Buying signals we&apos;ll look for</Label>
        <div className="flex flex-wrap gap-1.5">
          {icp.buyingSignals.map((signal) => (
            <Badge key={signal.key} tone="neutral" title={signal.description}>
              {signal.label}
            </Badge>
          ))}
        </div>
      </Field>
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
    </div>
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

export function OnboardingWizard({ initial }: { initial: OnboardingInitial }) {
  const router = useRouter();
  const [step, setStep] = React.useState(initial.profile && !initial.newWorkspace ? (initial.icp ? 2 : 1) : 0);
  const [errors, setErrors] = React.useState<BusinessErrors>({});
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
      router.push(data.campaignId ? `/app/discover?campaignId=${data.campaignId}` : "/app");
      router.refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  async function next() {
    if (step === 0) {
      const found = validateBusiness(business);
      setErrors(found);
      if (Object.keys(found).length) return;
      try {
        await saveBusiness.mutateAsync();
        setStep(1);
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
        setStep(2);
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
    setStep((value) => value + 1);
  }

  const busy = saveBusiness.isPending || saveIcp.isPending || finish.isPending;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <p className="text-xs text-foreground-muted">
            Step {step + 1} of {STEPS.length}
          </p>
        </div>
      </header>
      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[200px_1fr]">
        <nav aria-label="Onboarding steps" className="hidden lg:block">
          <ol className="sticky top-20 grid gap-1">
            {STEPS.map((label, index) => (
              <li
                key={label}
                className={cn(
                  "flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px]",
                  index === step ? "bg-surface-muted font-medium text-foreground" : index < step ? "text-foreground-secondary" : "text-foreground-subtle",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full border text-[10px] font-semibold",
                    index < step ? "border-transparent bg-foreground text-background" : index === step ? "border-foreground" : "border-border-strong",
                  )}
                >
                  {index < step ? <Check className="size-3" /> : index + 1}
                </span>
                {label}
              </li>
            ))}
          </ol>
        </nav>

        <main className="min-w-0">
          <div className="mb-6">
            <h1 className="text-xl font-semibold tracking-[-0.01em]">
              {step === 0 && (initial.newWorkspace ? "Set up a new workspace" : `Welcome, ${initial.userName.split(" ")[0]}. Tell us about your business`)}
              {step === 1 && "Your ideal customers"}
              {step === 2 && "Define your first campaign"}
              {step === 3 && "How should we reach them?"}
              {step === 4 && "Choose your automation level"}
              {step === 5 && "Review and launch setup"}
            </h1>
            <p className="mt-1 text-[13px] text-foreground-muted">
              {step === 0 && "We use this to understand what you sell and who is likely to buy it."}
              {step === 1 && "Generated from your profile. Edit anything — this guides discovery, scoring and pitches."}
              {step === 2 && "A campaign groups a target audience with an offer and an outreach sequence."}
              {step === 3 && "Only channels available on your plan can be selected. Providers are configured in Integrations."}
              {step === 4 && "You can change this per campaign at any time. Automated outreach always respects your limits and provider policies."}
              {step === 5 && "Nothing is sent yet. Next, you'll discover leads for this campaign and review them before any outreach."}
            </p>
          </div>

          {step === 0 ? <BusinessStep state={business} setState={setBusiness} errors={errors} /> : null}

          {step === 1 ? (
            analyze.isPending ? (
              <AnalysisProgress />
            ) : analyze.isError && !icp ? (
              <Callout tone="danger" title="AI analysis failed" action={<Button size="sm" onClick={() => analyze.mutate(true)}><RefreshCw /> Retry</Button>}>
                {analyze.error instanceof ApiError && analyze.error.code === "PROVIDER_NOT_CONFIGURED"
                  ? "No AI provider is configured. An admin can connect one in Integrations."
                  : errorMessage(analyze.error)}
              </Callout>
            ) : icp ? (
              <>
                <div className="mb-4 flex justify-end">
                  <Button variant="ghost" size="sm" onClick={() => analyze.mutate(true)}>
                    <RefreshCw /> Regenerate
                  </Button>
                </div>
                <IcpEditor icp={icp} onChange={setIcp} />
              </>
            ) : (
              <div className="flex justify-center py-12">
                <Button variant="primary" onClick={() => analyze.mutate(false)}>
                  <Sparkles /> Analyse my business
                </Button>
              </div>
            )
          ) : null}

          {step === 2 ? (
            <div className="grid gap-5">
              <Field>
                <Label htmlFor="campaign-name">Campaign name</Label>
                <Input id="campaign-name" placeholder="Delhi Cafe Outreach" value={campaign.name} onChange={(event) => setCampaign({ ...campaign, name: event.target.value })} />
              </Field>
              <Field>
                <Label>Target businesses</Label>
                <TagInput
                  value={campaign.categories}
                  onChange={(categories) => setCampaign({ ...campaign, categories })}
                  suggestions={icp?.targetCategories ?? []}
                  placeholder="cafe, restaurant…"
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
                <Field>
                  <Label htmlFor="location">Location</Label>
                  <Input id="location" placeholder="Delhi NCR" value={campaign.location} onChange={(event) => setCampaign({ ...campaign, location: event.target.value })} />
                  {icp?.recommendedLocations.length ? (
                    <div className="flex flex-wrap gap-1">
                      {icp.recommendedLocations.map((location) => (
                        <button key={location} type="button" onClick={() => setCampaign({ ...campaign, location })} className="rounded-[4px] border border-dashed border-border-strong px-2 py-0.5 text-xs text-foreground-muted hover:text-foreground">
                          {location}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </Field>
                <Field>
                  <Label>Radius</Label>
                  <Select value={String(campaign.radiusKm)} onValueChange={(value) => setCampaign({ ...campaign, radiusKm: Number(value) })}>
                    <SelectTrigger>
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
              <Field>
                <Label htmlFor="criteria">Lead criteria</Label>
                <Input id="criteria" placeholder="Independent cafés with 2+ locations" value={campaign.criteria} onChange={(event) => setCampaign({ ...campaign, criteria: event.target.value })} />
              </Field>
              <Field>
                <Label htmlFor="offer">Offer</Label>
                <Textarea id="offer" rows={2} placeholder="Custom branded cups, MOQ 5,000" value={campaign.offerSummary} onChange={(event) => setCampaign({ ...campaign, offerSummary: event.target.value })} />
              </Field>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="grid gap-6">
              <div className="grid gap-2 sm:grid-cols-2">
                {(["EMAIL", "WHATSAPP", "VOICE", "MANUAL_CALL"] as Channel[]).map((channel) => {
                  const Icon = CHANNEL_ICONS[channel];
                  const available = allowed.channels.includes(channel);
                  const selected = campaign.channels.includes(channel);
                  return (
                    <button
                      key={channel}
                      type="button"
                      disabled={!available}
                      onClick={() =>
                        setCampaign({
                          ...campaign,
                          channels: selected ? campaign.channels.filter((item) => item !== channel) : [...campaign.channels, channel],
                        })
                      }
                      className={cn(
                        "flex items-start gap-3 rounded-lg border bg-surface p-3 text-left transition-[border,box-shadow]",
                        selected ? "border-foreground shadow-[0_0_0_1px_var(--foreground)]" : "border-border hover:border-border-strong",
                        !available && "cursor-not-allowed opacity-60",
                      )}
                    >
                      <Icon className="mt-0.5 size-4 text-foreground-muted" />
                      <span className="flex-1">
                        <span className="flex items-center gap-2 text-[13px] font-medium">
                          {CHANNEL_LABELS[channel]}
                          {!available ? (
                            <Badge tone="outline">
                              <Lock /> Pro
                            </Badge>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-xs text-foreground-muted">
                          {channel === "EMAIL" && "Personalised emails and follow-ups with unsubscribe handling."}
                          {channel === "WHATSAPP" && "Approved template messages via the official Business API."}
                          {channel === "VOICE" && "AI voice agent calls with consent controls and transcripts."}
                          {channel === "MANUAL_CALL" && "AI prepares a call brief; you make the call."}
                        </span>
                      </span>
                      {selected ? <Check className="size-4" /> : null}
                    </button>
                  );
                })}
              </div>
              <Field>
                <Label>Outreach tone</Label>
                <div className="flex flex-wrap gap-2">
                  {TONES.map((tone) => (
                    <button
                      key={tone.value}
                      type="button"
                      onClick={() => setCampaign({ ...campaign, tone: tone.value })}
                      className={cn(
                        "h-8 rounded-md border px-3 text-[13px] transition-colors",
                        campaign.tone === tone.value ? "border-foreground bg-surface font-medium" : "border-border text-foreground-secondary hover:border-border-strong",
                      )}
                    >
                      {tone.label}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          ) : null}

          {step === 4 ? (
            <RadioGroup value={campaign.automationMode} onValueChange={(value) => setCampaign({ ...campaign, automationMode: value as AutomationMode })} className="grid gap-2">
              {(["MANUAL", "ASSISTED", "AUTOMATED"] as AutomationMode[]).map((mode) => {
                const Icon = MODE_ICONS[mode];
                const available = allowed.modes.includes(mode);
                return (
                  <RadioCard key={mode} value={mode} disabled={!available}>
                    <span className="flex w-full items-center gap-2">
                      <Icon className="size-4 text-foreground-muted" />
                      <span className="text-[13px] font-medium">{AUTOMATION_MODE_LABELS[mode].label}</span>
                      {mode === "ASSISTED" ? <Badge tone="accent">Recommended</Badge> : null}
                      {!available ? (
                        <Badge tone="outline" className="ml-auto">
                          <Lock /> Not on {allowed.planName}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="pl-6 text-xs text-foreground-muted">{AUTOMATION_MODE_LABELS[mode].description}</span>
                  </RadioCard>
                );
              })}
            </RadioGroup>
          ) : null}

          {step === 5 ? (
            <div className="grid gap-3">
              {[
                ["Business", `${business.name} — ${business.industry}`],
                ["Sells", business.offerings.filter((o) => o.name).map((o) => o.name).join(", ")],
                ["Campaign", campaign.name],
                ["Targets", `${campaign.categories.join(", ") || "—"} in ${campaign.location || "—"} (${campaign.radiusKm} km)`],
                ["Channels", campaign.channels.map((channel) => CHANNEL_LABELS[channel]).join(", ")],
                ["Automation", AUTOMATION_MODE_LABELS[campaign.automationMode].label],
              ].map(([label, value]) => (
                <div key={label} className="grid grid-cols-[120px_1fr] gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-[13px]">
                  <span className="text-foreground-muted">{label}</span>
                  <span>{value}</span>
                </div>
              ))}
              <Callout tone="neutral">The campaign is created as a draft. Launching it later shows estimated volume, AI usage and cost, and asks for explicit confirmation.</Callout>
            </div>
          ) : null}

          <div className="mt-8 flex items-center justify-between border-t border-border pt-5">
            <Button variant="ghost" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={step === 0 || busy}>
              <ArrowLeft /> Back
            </Button>
            <div className="flex items-center gap-2">
              {step >= 2 ? (
                <Button variant="ghost" onClick={() => finish.mutate(false)} disabled={busy}>
                  Skip for now
                </Button>
              ) : null}
              <Button variant="primary" onClick={next} loading={busy} disabled={step === 1 && (!icp || analyze.isPending)}>
                {step === 5 ? "Finish & find leads" : "Continue"}
                {step < 5 ? <ArrowRight /> : null}
              </Button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
