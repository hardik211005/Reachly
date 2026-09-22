"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Bot, Check, Copy, CreditCard, ExternalLink, HardDrive, Mail, MessageCircle, PhoneCall, Plug, Telescope, Workflow } from "lucide-react";
import { motion } from "motion/react";
import {
  Badge,
  Button,
  ErrorState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Skeleton,
  SpotlightCard,
  Spinner,
  Stagger,
  StaggerItem,
  StatusBadge,
  cn,
  toast,
} from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { PageHero } from "../page-hero";
import { useCanManage } from "../shell/shell-context";

type Mode = "connected" | "platform" | "mock" | "not_configured";
interface Field {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  type?: "text" | "email" | "number" | "select" | "url";
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  help?: string;
}
interface Provider {
  provider: string;
  category: string;
  name: string;
  description: string;
  docsUrl: string;
  fields: Field[];
  connection: null | { id: string; status: "CONNECTED" | "DISCONNECTED" | "ERROR"; isDefault: boolean; config: Record<string, unknown>; secretsSet: string[]; webhookUrl: string | null; lastError: string | null; updatedAt: string };
}
interface Status {
  category: string;
  label: string;
  mode: Mode;
  provider: string | null;
}

const CATEGORIES = [
  { key: "AI", label: "AI models", icon: Bot, blurb: "Powers qualification, writing, call analysis and insights." },
  { key: "LEAD_DATA", label: "Lead data", icon: Telescope, blurb: "Where discovery searches for businesses." },
  { key: "EMAIL", label: "Email", icon: Mail, blurb: "Send outreach from your own domain." },
  { key: "WHATSAPP", label: "WhatsApp", icon: MessageCircle, blurb: "Your WhatsApp Business number." },
  { key: "VOICE", label: "Voice", icon: PhoneCall, blurb: "Phone numbers for the AI voice agent." },
  { key: "NOTIFICATION", label: "Team notifications", icon: Bell, blurb: "Tell your team about hot leads and wins." },
];

const PLATFORM_ONLY = [
  { key: "AUTOMATION", label: "n8n", icon: Workflow, href: "/app/workflows", description: "Run steps in your n8n instance and let it resume workflows." },
  { key: "PAYMENTS", label: "Payments", icon: CreditCard, href: "/app/billing", description: "Card subscriptions (Stripe) and UPI (Razorpay) for your plan." },
  { key: "STORAGE", label: "File storage", icon: HardDrive, href: null, description: "Where quote PDFs and attachments are kept." },
];

const MODE: Record<Mode, { label: string; tone: "success" | "accent" | "warning" | "muted" }> = {
  connected: { label: "Your account", tone: "success" },
  platform: { label: "Provided", tone: "accent" },
  mock: { label: "Demo — simulated", tone: "warning" },
  not_configured: { label: "Not set up", tone: "muted" },
};

function Monogram({ name, active }: { name: string; active: boolean }) {
  const letters = name
    .replace(/[^A-Za-z ]/g, "")
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2);
  return <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold tracking-tight", active ? "bg-brand-gradient text-white shadow-[var(--brand-glow)]" : "border border-border bg-surface-muted text-foreground-secondary")}>{letters}</span>;
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2">
      <code className="min-w-0 flex-1 truncate font-mono text-[12px]">{value}</code>
      <button
        type="button"
        aria-label="Copy webhook URL"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="text-foreground-muted hover:text-foreground"
      >
        {copied ? <Check className="size-4 text-good" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}

function ConnectSheet({ provider, open, onOpenChange }: { provider: Provider; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const connected = provider.connection?.status === "CONNECTED" || provider.connection?.status === "ERROR";
  const [values, setValues] = React.useState<Record<string, string>>(() => Object.fromEntries(provider.fields.filter((field) => !field.secret).map((field) => [field.key, String(provider.connection?.config[field.key] ?? "")])));
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["integrations"] });
  const save = useMutation({
    mutationFn: () => api(`/api/v1/integrations/${provider.provider}`, { method: "PUT", json: { values } }),
    onSuccess: () => {
      toast.success(`${provider.name} ${connected ? "updated" : "connected"}`);
      invalidate();
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const disconnect = useMutation({
    mutationFn: () => api(`/api/v1/integrations/${provider.provider}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(`${provider.name} disconnected`);
      invalidate();
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const test = useMutation({
    mutationFn: () => api<{ ok: boolean; message: string }>(`/api/v1/integrations/${provider.provider}/test`, { method: "POST" }),
    onSuccess: (result) => (result.ok ? toast.success(result.message) : toast.error(result.message)),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const secretsSet = new Set(provider.connection?.secretsSet ?? []);
  const missing = provider.fields.some((field) => field.required && !(values[field.key] ?? "").trim() && !(field.secret && secretsSet.has(field.key)));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <div className="flex items-center gap-3">
            <Monogram name={provider.name} active={connected} />
            <div>
              <SheetTitle>{provider.name}</SheetTitle>
              <SheetDescription>{provider.description}</SheetDescription>
            </div>
          </div>
        </SheetHeader>
        <SheetBody>
          <form
            id={`connect-${provider.provider}`}
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!missing) save.mutate();
            }}
          >
            {provider.connection?.lastError ? <p className="rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger-text">Last check failed: {provider.connection.lastError}</p> : null}
            {provider.fields.map((field) => {
              const id = `${provider.provider}-${field.key}`;
              const saved = field.secret && secretsSet.has(field.key);
              return (
                <div key={field.key} className="grid gap-1.5">
                  <Label htmlFor={id}>
                    {field.label}
                    {field.required ? null : <span className="font-normal text-foreground-muted"> (optional)</span>}
                  </Label>
                  {field.type === "select" && field.options ? (
                    <Select value={values[field.key] ?? ""} onValueChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}>
                      <SelectTrigger id={id}>
                        <SelectValue placeholder={field.secret && saved ? "Saved — choose to change" : "Choose…"} />
                      </SelectTrigger>
                      <SelectContent>
                        {field.options.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input id={id} type={field.secret ? "password" : field.type === "email" ? "email" : field.type === "number" ? "text" : "text"} inputMode={field.type === "number" ? "numeric" : undefined} autoComplete="off" value={values[field.key] ?? ""} placeholder={saved ? "•••••••• saved — leave blank to keep" : field.placeholder} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />
                  )}
                  {field.help ? <p className="text-[12px] text-foreground-muted">{field.help}</p> : null}
                </div>
              );
            })}
            {provider.connection?.webhookUrl && connected ? (
              <div className="grid gap-1.5">
                <Label>Webhook URL</Label>
                <CopyField value={provider.connection.webhookUrl} />
                <p className="text-[12px] text-foreground-muted">Add this in {provider.name} so deliveries, replies and call updates reach this workspace.</p>
              </div>
            ) : null}
            <p className="flex items-center gap-1.5 text-[12px] text-foreground-muted">
              Secrets are encrypted and never shown again.{" "}
              <a href={provider.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-foreground-secondary hover:text-foreground">
                Docs <ExternalLink className="size-3" />
              </a>
            </p>
          </form>
        </SheetBody>
        <SheetFooter>
          {connected ? (
            <Button variant="ghost" className="mr-auto text-danger-text" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>
              Disconnect
            </Button>
          ) : null}
          {connected && provider.provider === "slack" ? (
            <Button variant="secondary" disabled={test.isPending} onClick={() => test.mutate()}>
              {test.isPending ? <Spinner className="size-3.5" /> : null} Send test
            </Button>
          ) : null}
          <Button variant="primary" type="submit" form={`connect-${provider.provider}`} disabled={missing || save.isPending}>
            {save.isPending ? <Spinner className="size-3.5" /> : null} {connected ? "Save" : "Connect"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ProviderCard({ provider, canManage, onOpen }: { provider: Provider; canManage: boolean; onOpen: () => void }) {
  const state = provider.connection?.status;
  const active = state === "CONNECTED";
  return (
    <SpotlightCard className={cn("lift flex h-full flex-col rounded-xl border bg-surface p-4 shadow-xs", active ? "border-gradient border-transparent" : "border-border")}>
      <div className="flex items-start gap-3">
        <Monogram name={provider.name} active={active} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-[14px] font-semibold">
            {provider.name}
            {active ? <Badge tone="success">{provider.connection?.isDefault ? "In use" : "Connected"}</Badge> : state === "ERROR" ? <Badge tone="danger">Needs attention</Badge> : null}
          </p>
          <p className="mt-0.5 text-[12.5px] leading-snug text-foreground-muted">{provider.description}</p>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between pt-4">
        <a href={provider.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-foreground-muted hover:text-foreground">
          Docs <ExternalLink className="size-3" />
        </a>
        {canManage ? (
          <Button size="sm" variant={active ? "secondary" : "primary"} onClick={onOpen} aria-label={`${active || state === "ERROR" ? "Manage" : "Connect"} ${provider.name}`}>
            {active || state === "ERROR" ? "Manage" : "Connect"}
          </Button>
        ) : null}
      </div>
    </SpotlightCard>
  );
}

export function IntegrationsView() {
  const canManage = useCanManage();
  const data = useQuery({ queryKey: ["integrations"], queryFn: () => api<{ providers: Provider[]; statuses: Status[] }>("/api/v1/integrations") });
  const [openProvider, setOpenProvider] = React.useState<string | null>(null);
  const statusFor = (category: string) => data.data?.statuses.find((status) => status.category === category);
  const selected = data.data?.providers.find((provider) => provider.provider === openProvider) ?? null;

  return (
    <div className="grid gap-6">
      <PageHero title="Integrations" highlight="Integrations" description="Connect your own accounts for AI, email, WhatsApp, voice and notifications. Anything you don't connect uses the platform's provider, or a clearly labelled simulation in demo mode." />
      {data.isError ? (
        <ErrorState description={errorMessage(data.error)} onRetry={() => void data.refetch()} />
      ) : !data.data ? (
        <Skeleton className="h-[480px] rounded-xl" />
      ) : (
        <>
          <Stagger className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {CATEGORIES.map((category) => {
              const status = statusFor(category.key);
              const mode = MODE[status?.mode ?? "not_configured"];
              return (
                <StaggerItem key={category.key}>
                  <a href={`#${category.key.toLowerCase()}`} className="flex h-full flex-col gap-2 rounded-xl border border-border bg-surface p-3 transition-colors hover:border-border-strong">
                    <category.icon className="size-4 text-brand-1" />
                    <span className="text-[13px] font-semibold">{category.label}</span>
                    <StatusBadge tone={mode.tone} className="w-fit">
                      {status?.mode === "connected" || status?.mode === "platform" ? `${mode.label} · ${status.provider}` : mode.label}
                    </StatusBadge>
                  </a>
                </StaggerItem>
              );
            })}
          </Stagger>

          {CATEGORIES.map((category) => {
            const providers = data.data.providers.filter((provider) => provider.category === category.key);
            if (!providers.length) return null;
            return (
              <section key={category.key} id={category.key.toLowerCase()} className="scroll-mt-24">
                <div className="mb-3 flex items-center gap-2">
                  <category.icon className="size-4 text-foreground-muted" />
                  <h2 className="text-[14px] font-semibold">{category.label}</h2>
                  <span className="text-[12.5px] text-foreground-muted">· {category.blurb}</span>
                </div>
                <Stagger inView step={0.05} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {providers.map((provider) => (
                    <StaggerItem key={provider.provider}>
                      <ProviderCard provider={provider} canManage={canManage} onOpen={() => setOpenProvider(provider.provider)} />
                    </StaggerItem>
                  ))}
                </Stagger>
              </section>
            );
          })}

          <section>
            <div className="mb-3 flex items-center gap-2">
              <Plug className="size-4 text-foreground-muted" />
              <h2 className="text-[14px] font-semibold">Set up by your administrator</h2>
              <span className="text-[12.5px] text-foreground-muted">· configured on the server, not per workspace</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {PLATFORM_ONLY.map((item) => {
                const status = statusFor(item.key);
                const ready = status?.mode === "platform" || status?.mode === "connected";
                return (
                  <motion.div key={item.key} initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="flex h-full flex-col gap-2 rounded-xl border border-border bg-surface p-4">
                    <div className="flex items-center gap-2">
                      <item.icon className="size-4 text-brand-1" />
                      <span className="text-[14px] font-semibold">{item.label}</span>
                      <StatusBadge tone={ready ? "success" : "muted"} className="ml-auto">
                        {ready ? `Ready · ${status?.provider}` : "Not set up"}
                      </StatusBadge>
                    </div>
                    <p className="text-[12.5px] text-foreground-muted">{item.description}</p>
                    {item.href ? (
                      <Link href={item.href} className="mt-auto text-[12.5px] font-medium text-foreground-secondary hover:text-foreground">
                        Open {item.label} →
                      </Link>
                    ) : null}
                  </motion.div>
                );
              })}
            </div>
          </section>
        </>
      )}
      {selected ? <ConnectSheet key={selected.provider + (selected.connection?.updatedAt ?? "")} provider={selected} open={Boolean(openProvider)} onOpenChange={(open) => !open && setOpenProvider(null)} /> : null}
    </div>
  );
}
