"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, ChevronsUpDown, Globe2, Info } from "lucide-react";
import { Button, Command, CommandEmpty, CommandInput, CommandItem, CommandList, ErrorState, Input, Popover, PopoverContent, PopoverTrigger, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, cn, toast } from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { useCanManage, useShell } from "../shell/shell-context";
import { ReadOnlyNotice, Row, SaveBar, Section } from "./kit";

interface Workspace {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  country: string | null;
  createdAt: string;
  currencies: string[];
}
type Form = Pick<Workspace, "name" | "timezone" | "currency"> & { country: string };

const CURRENCY_NAMES: Record<string, string> = { INR: "Indian rupee", USD: "US dollar", EUR: "Euro", GBP: "British pound", AED: "UAE dirham", SGD: "Singapore dollar", AUD: "Australian dollar" };

function zones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC", "Asia/Kolkata"];
  }
}

function offsetLabel(zone: string) {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((item) => item.type === "timeZoneName");
    return part?.value.replace("GMT", "UTC") ?? "";
  } catch {
    return "";
  }
}

function TimeZonePicker({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const all = React.useMemo(() => zones(), []);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id="workspace-timezone" variant="secondary" role="combobox" aria-expanded={open} disabled={disabled} className="w-full justify-between font-normal">
          <span className="truncate">
            {value.replace(/_/g, " ")} <span className="text-foreground-muted">· {offsetLabel(value)}</span>
          </span>
          <ChevronsUpDown className="text-foreground-muted" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search time zones…" />
          <CommandList className="max-h-64">
            <CommandEmpty>No time zone found.</CommandEmpty>
            {all.map((zone) => (
              <CommandItem
                key={zone}
                value={zone}
                onSelect={() => {
                  onChange(zone);
                  setOpen(false);
                }}
              >
                <Check className={cn("size-3.5", zone === value ? "opacity-100" : "opacity-0")} />
                <span className="flex-1 truncate">{zone.replace(/_/g, " ")}</span>
                <span className="text-[11px] text-foreground-muted">{offsetLabel(zone)}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function toForm(workspace: Workspace): Form {
  return { name: workspace.name, timezone: workspace.timezone, currency: workspace.currency, country: workspace.country ?? "" };
}

function WorkspaceForm({ workspace }: { workspace: Workspace }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const canManage = useCanManage();
  const [form, setForm] = React.useState<Form>(() => toForm(workspace));
  const initial = toForm(workspace);
  const dirty = (Object.keys(form) as Array<keyof Form>).some((key) => form[key] !== initial[key]);
  const save = useMutation({
    mutationFn: () => api<Workspace>("/api/v1/workspace", { method: "PATCH", json: { ...form, country: form.country || null } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["workspace"], { ...workspace, ...updated });
      toast.success("Workspace updated");
      router.refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <Section title="Workspace" description="How your workspace appears and how dates and money are shown." icon={Building2} footer={canManage ? <SaveBar dirty={dirty} pending={save.isPending} onSave={() => save.mutate()} onReset={() => setForm(initial)} disabled={form.name.trim().length < 2} /> : null}>
      {canManage ? null : <ReadOnlyNotice what="workspace settings" />}
      <Row label="Workspace name" hint="Shown to your team and in outgoing emails when no sender name is set." htmlFor="workspace-name">
        <Input id="workspace-name" value={form.name} maxLength={80} disabled={!canManage} onChange={(event) => set("name", event.target.value)} />
      </Row>
      <Row label="Time zone" hint="Used for sending windows, reports and reply heatmaps." htmlFor="workspace-timezone">
        <TimeZonePicker value={form.timezone} onChange={(value) => set("timezone", value)} disabled={!canManage} />
      </Row>
      <Row label="Currency" hint="For deal values, quotes and cost reports. Existing amounts aren't converted.">
        <Select value={form.currency} onValueChange={(value) => set("currency", value)} disabled={!canManage}>
          <SelectTrigger aria-label="Currency">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {workspace.currencies.map((currency) => (
              <SelectItem key={currency} value={currency}>
                {currency} · {CURRENCY_NAMES[currency] ?? currency}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <Row label="Country" hint="Optional. Helps with phone number formatting." htmlFor="workspace-country">
        <Input id="workspace-country" value={form.country} maxLength={60} placeholder="India" disabled={!canManage} onChange={(event) => set("country", event.target.value)} />
      </Row>
    </Section>
  );
}

export function GeneralSettings() {
  const shell = useShell();
  const workspace = useQuery({ queryKey: ["workspace"], queryFn: () => api<Workspace>("/api/v1/workspace") });
  if (workspace.isError) return <ErrorState description={errorMessage(workspace.error)} onRetry={() => void workspace.refetch()} />;
  if (!workspace.data) return <Skeleton className="h-96 rounded-xl" />;
  return (
    <>
      <WorkspaceForm key={workspace.data.id} workspace={workspace.data} />
      <Section title="Details" description="For reference and support requests." icon={Info}>
        <dl className="grid gap-4 text-[13px] sm:grid-cols-2">
          <div>
            <dt className="text-foreground-muted">Workspace ID</dt>
            <dd className="mt-0.5 font-mono text-[12px] break-all">{workspace.data.id}</dd>
          </div>
          <div>
            <dt className="text-foreground-muted">URL name</dt>
            <dd className="mt-0.5 font-mono text-[12px]">{workspace.data.slug}</dd>
          </div>
          <div>
            <dt className="text-foreground-muted">Created</dt>
            <dd className="mt-0.5">{new Date(workspace.data.createdAt).toLocaleDateString(undefined, { dateStyle: "long" })}</dd>
          </div>
          <div>
            <dt className="text-foreground-muted">Plan</dt>
            <dd className="mt-0.5">
              {shell.plan.name} ·{" "}
              <Link href="/app/billing" className="font-medium text-foreground underline-offset-2 hover:underline">
                Manage plan
              </Link>
            </dd>
          </div>
        </dl>
      </Section>
      <Section title="Your role" description="What you can do in this workspace." icon={Globe2}>
        <p className="text-[13px] text-foreground-secondary">
          You&apos;re {shell.role === "ADMIN" || shell.role === "OWNER" ? "an" : "a"} <span className="font-semibold text-foreground">{shell.role.toLowerCase()}</span> here.{" "}
          <Link href="/app/settings/team" className="font-medium text-foreground underline-offset-2 hover:underline">
            See the team
          </Link>
        </p>
      </Section>
    </>
  );
}
