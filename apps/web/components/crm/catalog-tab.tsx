"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, Pencil, Percent, Plus, Settings2, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Field,
  FieldHint,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  Textarea,
  toast,
} from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { useCanManage } from "../shell/shell-context";
import { money } from "./shared";

type RuleType = "VOLUME_DISCOUNT_PERCENT" | "PERCENT_DISCOUNT" | "FIXED_DISCOUNT" | "MIN_QUANTITY" | "SETUP_FEE_WAIVER";

interface Offering {
  id: string;
  type: "PRODUCT" | "SERVICE" | "PACKAGE";
  sku: string | null;
  name: string;
  description: string | null;
  unit: string;
  unitPrice: number | null;
  setupFee: number | null;
  taxRatePercent: number | null;
  minOrderQuantity: number | null;
  currency: string;
  isActive: boolean;
}

interface Rule {
  id: string;
  name: string;
  type: RuleType;
  offeringId: string | null;
  offeringName: string | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  value: number;
  priority: number;
  isActive: boolean;
  description: string;
}

interface Catalog {
  currency: string;
  offerings: Offering[];
  rules: Rule[];
}

const RULE_TYPES: Array<{ value: RuleType; label: string; hint: string; valueLabel: string | null }> = [
  { value: "VOLUME_DISCOUNT_PERCENT", label: "Volume discount", hint: "A percentage off from a quantity. Only the best matching tier applies.", valueLabel: "% off" },
  { value: "PERCENT_DISCOUNT", label: "Percentage discount", hint: "A percentage off, e.g. a launch offer. Stacks with a volume tier.", valueLabel: "% off" },
  { value: "FIXED_DISCOUNT", label: "Fixed discount", hint: "A fixed amount off each matching line.", valueLabel: "Amount off" },
  { value: "MIN_QUANTITY", label: "Minimum order", hint: "Quotes below this quantity can't be sent.", valueLabel: "Minimum quantity" },
  { value: "SETUP_FEE_WAIVER", label: "Setup fee waiver", hint: "Waives the setup fee, usually above a quantity.", valueLabel: null },
];

function numberOrNull(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

function useInvalidateCatalog() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: ["catalog"] });
}

// ----------------------------------------------------------------------------- Offerings

function OfferingDialog({ offering, currency, onClose }: { offering: Offering | "new"; currency: string; onClose: () => void }) {
  const invalidate = useInvalidateCatalog();
  const initial = offering === "new" ? null : offering;
  const [form, setForm] = React.useState({
    type: initial?.type ?? "SERVICE",
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    unit: initial?.unit ?? "month",
    unitPrice: initial?.unitPrice?.toString() ?? "",
    setupFee: initial?.setupFee?.toString() ?? "",
    taxRatePercent: initial?.taxRatePercent?.toString() ?? (currency === "INR" ? "18" : ""),
    minOrderQuantity: initial?.minOrderQuantity?.toString() ?? "",
  });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: event.target.value });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        type: form.type,
        name: form.name.trim(),
        description: form.description.trim() || null,
        unit: form.unit.trim() || "unit",
        unitPrice: numberOrNull(form.unitPrice),
        setupFee: numberOrNull(form.setupFee),
        taxRatePercent: numberOrNull(form.taxRatePercent),
        minOrderQuantity: numberOrNull(form.minOrderQuantity),
        currency: initial?.currency ?? currency,
        sku: initial?.sku ?? null,
        isActive: initial?.isActive ?? true,
      };
      return initial ? api(`/api/v1/offerings/${initial.id}`, { method: "PATCH", json: body }) : api("/api/v1/offerings", { method: "POST", json: body });
    },
    onSuccess: () => {
      toast.success(initial ? "Saved" : "Added to your catalog");
      invalidate();
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? `Edit ${initial.name}` : "Add a product or service"}</DialogTitle>
          <DialogDescription>Quotes only ever use these prices. Leave the price empty for “price on request” — a person enters it on each quote.</DialogDescription>
        </DialogHeader>
        <div className="grid items-start gap-3 sm:grid-cols-2">
          <Field className="sm:col-span-2">
            <Label htmlFor="offering-name">Name</Label>
            <Input id="offering-name" value={form.name} onChange={set("name")} placeholder="Custom paper cups" autoFocus />
          </Field>
          <Field className="sm:col-span-2">
            <Label htmlFor="offering-description">Description</Label>
            <Textarea id="offering-description" rows={2} value={form.description} onChange={set("description")} placeholder="Shown under the line on quotes" />
          </Field>
          <Field>
            <Label>Type</Label>
            <Select value={form.type} onValueChange={(type) => setForm({ ...form, type: type as Offering["type"] })}>
              <SelectTrigger aria-label="Type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SERVICE">Service</SelectItem>
                <SelectItem value="PRODUCT">Product</SelectItem>
                <SelectItem value="PACKAGE">Package</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <Label htmlFor="offering-unit">Unit</Label>
            <Input id="offering-unit" value={form.unit} onChange={set("unit")} placeholder="month, project, cup…" />
          </Field>
          <Field>
            <Label htmlFor="offering-price">Unit price ({currency})</Label>
            <Input id="offering-price" type="number" min={0} step="0.01" value={form.unitPrice} onChange={set("unitPrice")} placeholder="Price on request" />
          </Field>
          <Field>
            <Label htmlFor="offering-setup">Setup fee</Label>
            <Input id="offering-setup" type="number" min={0} value={form.setupFee} onChange={set("setupFee")} placeholder="None" />
          </Field>
          <Field>
            <Label htmlFor="offering-tax">Tax rate (%)</Label>
            <Input id="offering-tax" type="number" min={0} max={100} step="0.01" value={form.taxRatePercent} onChange={set("taxRatePercent")} />
            {currency === "INR" ? <FieldHint>GST, e.g. 18</FieldHint> : null}
          </Field>
          <Field>
            <Label htmlFor="offering-moq">Minimum order</Label>
            <Input id="offering-moq" type="number" min={1} value={form.minOrderQuantity} onChange={set("minOrderQuantity")} placeholder="None" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={form.name.trim().length < 2} loading={save.isPending} onClick={() => save.mutate()}>
            {initial ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------- Rules

function RuleDialog({ rule, offerings, currency, onClose }: { rule: Rule | "new"; offerings: Offering[]; currency: string; onClose: () => void }) {
  const invalidate = useInvalidateCatalog();
  const initial = rule === "new" ? null : rule;
  const [form, setForm] = React.useState({
    name: initial?.name ?? "",
    type: initial?.type ?? ("VOLUME_DISCOUNT_PERCENT" as RuleType),
    offeringId: initial?.offeringId ?? "all",
    minQuantity: initial?.minQuantity?.toString() ?? "",
    maxQuantity: initial?.maxQuantity?.toString() ?? "",
    value: initial?.value?.toString() ?? "",
    priority: initial?.priority?.toString() ?? "0",
  });
  const meta = RULE_TYPES.find((item) => item.value === form.type)!;
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(),
        type: form.type,
        offeringId: form.offeringId === "all" ? null : form.offeringId,
        minQuantity: numberOrNull(form.minQuantity),
        maxQuantity: numberOrNull(form.maxQuantity),
        value: form.type === "SETUP_FEE_WAIVER" ? 0 : Number(form.value) || 0,
        priority: Number(form.priority) || 0,
        isActive: initial?.isActive ?? true,
      };
      return initial ? api(`/api/v1/pricing-rules/${initial.id}`, { method: "PATCH", json: body }) : api("/api/v1/pricing-rules", { method: "POST", json: body });
    },
    onSuccess: () => {
      toast.success(initial ? "Rule saved" : "Rule added");
      invalidate();
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit pricing rule" : "New pricing rule"}</DialogTitle>
          <DialogDescription>Rules apply to catalog prices automatically, and every quote shows which rule changed a price.</DialogDescription>
        </DialogHeader>
        <div className="grid items-start gap-3 sm:grid-cols-2">
          <Field className="sm:col-span-2">
            <Label htmlFor="rule-name">Name</Label>
            <Input id="rule-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="6+ months commitment" autoFocus />
          </Field>
          <Field>
            <Label>Rule</Label>
            <Select value={form.type} onValueChange={(type) => setForm({ ...form, type: type as RuleType })}>
              <SelectTrigger aria-label="Rule type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RULE_TYPES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <Label>Applies to</Label>
            <Select value={form.offeringId} onValueChange={(offeringId) => setForm({ ...form, offeringId })}>
              <SelectTrigger aria-label="Applies to">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Every catalog item</SelectItem>
                {offerings.map((offering) => (
                  <SelectItem key={offering.id} value={offering.id}>
                    {offering.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <p className="text-xs text-foreground-muted sm:col-span-2">{meta.hint}</p>
          {meta.valueLabel ? (
            <Field>
              <Label htmlFor="rule-value">
                {meta.valueLabel}
                {form.type === "FIXED_DISCOUNT" ? ` (${currency})` : ""}
              </Label>
              <Input id="rule-value" type="number" min={0} value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} />
            </Field>
          ) : null}
          {form.type !== "MIN_QUANTITY" ? (
            <>
              <Field>
                <Label htmlFor="rule-min">From quantity</Label>
                <Input id="rule-min" type="number" min={1} value={form.minQuantity} onChange={(event) => setForm({ ...form, minQuantity: event.target.value })} placeholder="Any" />
              </Field>
              <Field>
                <Label htmlFor="rule-max">Up to quantity</Label>
                <Input id="rule-max" type="number" min={1} value={form.maxQuantity} onChange={(event) => setForm({ ...form, maxQuantity: event.target.value })} placeholder="Any" />
              </Field>
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={form.name.trim().length < 2 || (meta.valueLabel !== null && !form.value)} loading={save.isPending} onClick={() => save.mutate()}>
            {initial ? "Save rule" : "Add rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------- Quote settings

interface QuoteSettings {
  numberPrefix: string;
  nextNumber: number;
  validityDays: number;
  legalName: string | null;
  address: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  terms: string | null;
  footer: string | null;
}

function QuoteSettingsForm({ settings, currency }: { settings: QuoteSettings; currency: string }) {
  const canManage = useCanManage();
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState({
    numberPrefix: settings.numberPrefix,
    validityDays: String(settings.validityDays),
    legalName: settings.legalName ?? "",
    address: settings.address ?? "",
    taxId: settings.taxId ?? "",
    email: settings.email ?? "",
    phone: settings.phone ?? "",
    terms: settings.terms ?? "",
    footer: settings.footer ?? "",
  });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: event.target.value });
  const save = useMutation({
    mutationFn: () =>
      api("/api/v1/quotes/settings", {
        method: "PATCH",
        json: {
          numberPrefix: form.numberPrefix.trim(),
          validityDays: Number(form.validityDays) || 15,
          legalName: form.legalName.trim() || null,
          address: form.address.trim() || null,
          taxId: form.taxId.trim() || null,
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          terms: form.terms.trim() || null,
          footer: form.footer.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success("Quote settings saved");
      void queryClient.invalidateQueries({ queryKey: ["quote-settings"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const year = new Date().getFullYear();
  return (
    <form
      className="grid items-start gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <Field>
        <Label htmlFor="qs-prefix">Number prefix</Label>
        <Input id="qs-prefix" value={form.numberPrefix} onChange={set("numberPrefix")} disabled={!canManage} />
        <FieldHint>
          Next quote: {form.numberPrefix || "Q"}-{year}-{String(settings.nextNumber).padStart(4, "0")}
        </FieldHint>
      </Field>
      <Field>
        <Label htmlFor="qs-validity">Valid for (days)</Label>
        <Input id="qs-validity" type="number" min={1} max={365} value={form.validityDays} onChange={set("validityDays")} disabled={!canManage} />
      </Field>
      <Field>
        <Label htmlFor="qs-legal">Legal name</Label>
        <Input id="qs-legal" value={form.legalName} onChange={set("legalName")} disabled={!canManage} />
      </Field>
      <Field>
        <Label htmlFor="qs-tax">{currency === "INR" ? "GSTIN" : "Tax ID"}</Label>
        <Input id="qs-tax" value={form.taxId} onChange={set("taxId")} disabled={!canManage} placeholder={currency === "INR" ? "22AAAAA0000A1Z5" : ""} />
      </Field>
      <Field className="sm:col-span-2">
        <Label htmlFor="qs-address">Address</Label>
        <Input id="qs-address" value={form.address} onChange={set("address")} disabled={!canManage} />
      </Field>
      <Field>
        <Label htmlFor="qs-email">Email on quotes</Label>
        <Input id="qs-email" type="email" value={form.email} onChange={set("email")} disabled={!canManage} />
      </Field>
      <Field>
        <Label htmlFor="qs-phone">Phone on quotes</Label>
        <Input id="qs-phone" value={form.phone} onChange={set("phone")} disabled={!canManage} />
      </Field>
      <Field className="sm:col-span-2">
        <Label htmlFor="qs-terms">Default terms</Label>
        <Textarea id="qs-terms" rows={3} value={form.terms} onChange={set("terms")} disabled={!canManage} />
      </Field>
      <Field className="sm:col-span-2">
        <Label htmlFor="qs-footer">PDF footer</Label>
        <Input id="qs-footer" value={form.footer} onChange={set("footer")} disabled={!canManage} placeholder="Defaults to your business name and website" />
      </Field>
      {canManage ? (
        <div className="flex justify-end sm:col-span-2">
          <Button type="submit" variant="primary" size="sm" loading={save.isPending}>
            Save settings
          </Button>
        </div>
      ) : null}
    </form>
  );
}

// ----------------------------------------------------------------------------- Tab

export function CatalogTab() {
  const canManage = useCanManage();
  const invalidate = useInvalidateCatalog();
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: () => api<Catalog>("/api/v1/catalog") });
  const settings = useQuery({ queryKey: ["quote-settings"], queryFn: () => api<QuoteSettings>("/api/v1/quotes/settings") });
  const [editingOffering, setEditingOffering] = React.useState<Offering | "new" | null>(null);
  const [editingRule, setEditingRule] = React.useState<Rule | "new" | null>(null);

  const toggleOffering = useMutation({
    mutationFn: (offering: Offering) =>
      api(`/api/v1/offerings/${offering.id}`, {
        method: "PATCH",
        json: { ...offering, isActive: !offering.isActive },
      }),
    onSuccess: () => invalidate(),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const removeOffering = useMutation({
    mutationFn: (id: string) => api(`/api/v1/offerings/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidate(),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const toggleRule = useMutation({
    mutationFn: (rule: Rule) =>
      api(`/api/v1/pricing-rules/${rule.id}`, {
        method: "PATCH",
        json: { name: rule.name, type: rule.type, offeringId: rule.offeringId, minQuantity: rule.minQuantity, maxQuantity: rule.maxQuantity, value: rule.value, priority: rule.priority, isActive: !rule.isActive },
      }),
    onSuccess: () => invalidate(),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const removeRule = useMutation({
    mutationFn: (id: string) => api(`/api/v1/pricing-rules/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidate(),
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (catalog.isPending) return <Skeleton className="h-96" />;
  if (catalog.isError) return <ErrorState description={errorMessage(catalog.error)} onRetry={() => void catalog.refetch()} />;
  const { offerings, rules, currency } = catalog.data;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
      <section className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Package className="size-4 text-foreground-muted" /> Products & services
            </h2>
            <p className="mt-0.5 text-xs text-foreground-muted">The only source of prices for quotes. AI drafts pick from this list and never invent a price.</p>
          </div>
          {canManage ? (
            <Button size="sm" variant="secondary" onClick={() => setEditingOffering("new")}>
              <Plus /> Add
            </Button>
          ) : null}
        </div>
        {offerings.length === 0 ? (
          <EmptyState compact icon={Package} title="Your catalog is empty" description="Add what you sell so quotes can be priced." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <table className="w-full table-fixed text-left text-[13px]">
              <thead className="border-b border-border bg-surface-muted/60 text-[11px] text-foreground-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="w-36 px-3 py-2 text-right font-medium">Price</th>
                  <th className="hidden w-28 px-3 py-2 text-right font-medium md:table-cell">Setup</th>
                  <th className="hidden w-16 px-3 py-2 text-right font-medium md:table-cell">Tax</th>
                  <th className="hidden w-24 px-3 py-2 text-right font-medium lg:table-cell">Min. order</th>
                  <th className="w-24 px-3 py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {offerings.map((offering) => (
                  <tr key={offering.id} className={offering.isActive ? "" : "opacity-60"}>
                    <td className="px-3 py-2.5">
                      <p className="truncate font-medium">
                        {offering.name}
                        {!offering.isActive ? (
                          <Badge tone="neutral" className="ml-1.5">
                            Hidden
                          </Badge>
                        ) : null}
                      </p>
                      {offering.description ? <p className="truncate text-[11px] text-foreground-muted">{offering.description}</p> : null}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular">
                      {offering.unitPrice === null ? <span className="text-xs text-foreground-muted">On request</span> : money(offering.unitPrice, offering.currency)}
                      <span className="block text-[11px] text-foreground-muted">per {offering.unit}</span>
                    </td>
                    <td className="hidden px-3 py-2.5 text-right text-xs text-foreground-secondary tabular md:table-cell">{offering.setupFee ? money(offering.setupFee, offering.currency) : "—"}</td>
                    <td className="hidden px-3 py-2.5 text-right text-xs text-foreground-secondary tabular md:table-cell">{offering.taxRatePercent ? `${offering.taxRatePercent}%` : "—"}</td>
                    <td className="hidden px-3 py-2.5 text-right text-xs text-foreground-secondary tabular lg:table-cell">{offering.minOrderQuantity ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      {canManage ? (
                        <div className="flex items-center justify-end gap-1">
                          <Switch checked={offering.isActive} onCheckedChange={() => toggleOffering.mutate(offering)} aria-label={`Offer ${offering.name}`} />
                          <Button size="icon-xs" variant="ghost" aria-label={`Edit ${offering.name}`} onClick={() => setEditingOffering(offering)}>
                            <Pencil />
                          </Button>
                          <Button size="icon-xs" variant="ghost" aria-label={`Delete ${offering.name}`} onClick={() => removeOffering.mutate(offering.id)}>
                            <Trash2 />
                          </Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Percent className="size-4 text-foreground-muted" /> Pricing rules
            </h2>
            <p className="mt-0.5 text-xs text-foreground-muted">Volume tiers, offers, minimum orders and setup-fee waivers. Applied in priority order and explained on every quote.</p>
          </div>
          {canManage ? (
            <Button size="sm" variant="secondary" onClick={() => setEditingRule("new")} disabled={!offerings.length}>
              <Plus /> Add rule
            </Button>
          ) : null}
        </div>
        {rules.length === 0 ? (
          <EmptyState compact icon={Percent} title="No pricing rules" description="Quotes use list prices as they are." />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {rules.map((rule) => (
              <li key={rule.id} className={`flex items-center gap-3 px-3 py-2.5 ${rule.isActive ? "" : "opacity-60"}`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{rule.name}</p>
                  <p className="truncate text-xs text-foreground-muted">{rule.description}</p>
                </div>
                <Badge tone="neutral">{RULE_TYPES.find((item) => item.value === rule.type)?.label}</Badge>
                {canManage ? (
                  <>
                    <Switch checked={rule.isActive} onCheckedChange={() => toggleRule.mutate(rule)} aria-label={`Apply ${rule.name}`} />
                    <Button size="icon-xs" variant="ghost" aria-label={`Edit ${rule.name}`} onClick={() => setEditingRule(rule)}>
                      <Pencil />
                    </Button>
                    <Button size="icon-xs" variant="ghost" aria-label={`Delete ${rule.name}`} onClick={() => removeRule.mutate(rule.id)}>
                      <Trash2 />
                    </Button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Settings2 className="size-4 text-foreground-muted" /> Quote settings
          </h2>
          <p className="mt-0.5 text-xs text-foreground-muted">Numbering, validity and the business details printed on every quote.</p>
        </div>
        {settings.data ? <QuoteSettingsForm settings={settings.data} currency={currency} /> : <Skeleton className="h-64" />}
      </section>

      {editingOffering ? <OfferingDialog offering={editingOffering} currency={currency} onClose={() => setEditingOffering(null)} /> : null}
      {editingRule ? <RuleDialog rule={editingRule} offerings={offerings} currency={currency} onClose={() => setEditingRule(null)} /> : null}
    </div>
  );
}
