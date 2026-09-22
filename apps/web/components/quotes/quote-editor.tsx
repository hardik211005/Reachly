"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Link2,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Package,
  PenLine,
  Plus,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import { priceQuote, type CatalogOffering, type CatalogRule, type LineInput } from "@repo/core/quotes/pricing";
import {
  Badge,
  Button,
  Callout,
  CompanyMark,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  FieldHint,
  Input,
  Label,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
  Tooltip,
  cn,
  toast,
} from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { useCanWrite } from "../shell/shell-context";
import { LocalTime } from "../time";
import { QuoteStatusBadge, money } from "../crm/shared";
import { QuoteDocument, type QuoteDoc } from "./quote-document";
import { useDraftHints } from "./use-new-quote";

// ----------------------------------------------------------------------------- Types

export interface QuoteLine {
  id: string;
  offeringId: string | null;
  description: string;
  details: string | null;
  quantity: number;
  unit: string;
  unitPrice: number | null;
  setupFee: number;
  discount: number;
  taxRatePercent: number;
  lineTotal: number;
  priceSource: "catalog" | "manual" | "missing";
  appliedRules: Array<{ ruleId: string | null; name: string; type: string; amount: number; detail: string }>;
  input: LineInput;
}

export interface QuoteView extends Omit<QuoteDoc, "lines"> {
  id: string;
  expired: boolean;
  taxableTotal: number;
  generatedByAI: boolean;
  viewedAt: string | null;
  responseNote: string | null;
  lead: QuoteDoc["lead"] & { id: string };
  contact: (NonNullable<QuoteDoc["contact"]> & { id: string }) | null;
  deal: { id: string; title: string; stage: string } | null;
  lines: QuoteLine[];
  issues: string[];
  publicUrl: string;
  publicPdfUrl: string;
}

export interface EditorCatalog {
  currency: string;
  offerings: Array<CatalogOffering & { type: string }>;
  rules: CatalogRule[];
}

interface Draft {
  title: string;
  notes: string;
  terms: string;
  validUntil: string;
  contactId: string | null;
  lines: LineInput[];
}

function draftFrom(quote: QuoteView): Draft {
  return {
    title: quote.title ?? "",
    notes: quote.notes ?? "",
    terms: quote.terms ?? "",
    validUntil: quote.validUntil ? quote.validUntil.slice(0, 10) : "",
    contactId: quote.contact?.id ?? null,
    lines: quote.lines.map((line) => line.input),
  };
}

function payload(draft: Draft) {
  return {
    title: draft.title.trim() || null,
    notes: draft.notes.trim() || null,
    terms: draft.terms.trim() || null,
    validUntil: draft.validUntil ? new Date(`${draft.validUntil}T23:59:59`).toISOString() : null,
    contactId: draft.contactId,
    lines: draft.lines,
  };
}

function numberInput(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// ----------------------------------------------------------------------------- Line editor

function LineCard({
  line,
  priced,
  catalog,
  onChange,
  onRemove,
  hint,
}: {
  line: LineInput;
  priced: ReturnType<typeof priceQuote>["lines"][number];
  catalog: EditorCatalog;
  onChange: (line: LineInput) => void;
  onRemove: () => void;
  hint?: string;
}) {
  const offering = line.offeringId ? catalog.offerings.find((item) => item.id === line.offeringId) : null;
  const manual = line.unitPrice !== null && line.unitPrice !== undefined;
  const id = React.useId();
  return (
    <li className="rounded-lg border border-border bg-surface p-3 shadow-xs">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {line.offeringId ? (
            <Select value={line.offeringId} onValueChange={(offeringId) => onChange({ ...line, offeringId, description: null, unit: null, unitPrice: null })}>
              <SelectTrigger className="h-8 font-medium" aria-label="Catalog item">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {catalog.offerings
                  .filter((item) => item.isActive || item.id === line.offeringId)
                  .map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          ) : (
            <Input value={line.description ?? ""} onChange={(event) => onChange({ ...line, description: event.target.value })} placeholder="Item name" aria-label="Item name" className="h-8 font-medium" />
          )}
        </div>
        <div className="w-32 shrink-0 pt-1.5 text-right text-[13px] font-semibold tabular">{money(priced.lineTotal, catalog.currency, { decimals: 2 })}</div>
        <Button size="icon-xs" variant="ghost" aria-label={`Remove ${priced.description}`} onClick={onRemove} className="mt-1">
          <X />
        </Button>
      </div>
      <Input
        value={line.details ?? ""}
        onChange={(event) => onChange({ ...line, details: event.target.value || null })}
        placeholder={offering?.description ?? "Details shown under the item (optional)"}
        aria-label="Item details"
        className="mt-2 h-7 border-transparent px-2 text-xs text-foreground-secondary shadow-none hover:border-border focus-visible:border-border"
      />
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field>
          <Label htmlFor={`${id}-qty`} className="text-[11px]">
            Quantity{priced.unit ? ` (${priced.unit})` : ""}
          </Label>
          <Input id={`${id}-qty`} type="number" min={1} value={line.quantity} onChange={(event) => onChange({ ...line, quantity: Math.max(1, Math.round(Number(event.target.value) || 1)) })} className="h-8 tabular" />
        </Field>
        <Field>
          <Label htmlFor={`${id}-price`} className="text-[11px]">
            Unit price
          </Label>
          {line.offeringId && !manual && offering?.unitPrice !== null && offering?.unitPrice !== undefined ? (
            <div className="flex h-8 items-center justify-between gap-1 rounded-md border border-dashed border-border px-2">
              <span className="truncate text-[13px] tabular">{money(offering.unitPrice, catalog.currency, { decimals: 2 })}</span>
              <Tooltip content="Use a different agreed price for this quote">
                <button type="button" onClick={() => onChange({ ...line, unitPrice: offering.unitPrice })} className="text-foreground-subtle hover:text-foreground" aria-label="Override catalog price">
                  <PenLine className="size-3.5" />
                </button>
              </Tooltip>
            </div>
          ) : (
            <div className="relative">
              <Input
                id={`${id}-price`}
                type="number"
                min={0}
                step="0.01"
                value={line.unitPrice ?? ""}
                placeholder={line.offeringId ? "Agreed price" : "0"}
                onChange={(event) => onChange({ ...line, unitPrice: numberInput(event.target.value) })}
                className={cn("h-8 tabular", line.offeringId && offering?.unitPrice !== null && "pr-7", priced.priceSource === "missing" && "border-warning")}
              />
              {line.offeringId && offering?.unitPrice !== null && offering?.unitPrice !== undefined ? (
                <Tooltip content="Back to the catalog price">
                  <button type="button" onClick={() => onChange({ ...line, unitPrice: null })} className="absolute top-1/2 right-2 -translate-y-1/2 text-foreground-subtle hover:text-foreground" aria-label="Use catalog price">
                    <X className="size-3.5" />
                  </button>
                </Tooltip>
              ) : null}
            </div>
          )}
        </Field>
        <Field>
          <Label htmlFor={`${id}-discount`} className="text-[11px]">
            Extra discount
          </Label>
          <Input id={`${id}-discount`} type="number" min={0} value={line.discount ?? ""} placeholder="0" onChange={(event) => onChange({ ...line, discount: numberInput(event.target.value) })} className="h-8 tabular" />
        </Field>
        <Field>
          <Label htmlFor={`${id}-tax`} className="text-[11px]">
            Tax %
          </Label>
          <Input id={`${id}-tax`} type="number" min={0} max={100} value={line.taxRatePercent ?? ""} placeholder={String(offering?.taxRatePercent ?? 0)} onChange={(event) => onChange({ ...line, taxRatePercent: numberInput(event.target.value) })} className="h-8 tabular" />
        </Field>
      </div>
      {priced.appliedRules.length || priced.setupFee || priced.priceSource === "manual" || priced.issues.length || hint ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {priced.priceSource === "manual" && line.offeringId ? <Badge tone="warning">Agreed price (not catalog)</Badge> : null}
          {priced.setupFee ? <Badge tone="neutral">Setup fee {money(priced.setupFee, catalog.currency)}</Badge> : null}
          {priced.appliedRules.map((rule) => (
            <Tooltip key={`${rule.ruleId}-${rule.name}`} content={rule.detail}>
              <span>
                <Badge tone={rule.amount > 0 ? "success" : "neutral"}>
                  {rule.name}
                  {rule.amount > 0 ? ` −${money(rule.amount, catalog.currency)}` : ""}
                </Badge>
              </span>
            </Tooltip>
          ))}
          {priced.issues.map((issue) => (
            <span key={issue} className="inline-flex items-center gap-1 text-[11px] text-warning-text">
              <CircleAlert className="size-3" /> {issue}
            </span>
          ))}
          {hint ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-accent-soft-foreground">
              <Sparkles className="size-3" /> {hint}
            </span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

// ----------------------------------------------------------------------------- Send

interface Messages {
  email: { to: string | null; subject: string; body: string };
  whatsapp: { to: string | null; text: string };
  link: string;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          toast.success(`${label} copied`);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check /> : <Copy />} {label}
    </Button>
  );
}

function SendDialog({ quote, open, onOpenChange }: { quote: QuoteView; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [channel, setChannel] = React.useState<"EMAIL" | "WHATSAPP" | "LINK">("EMAIL");
  const [edits, setEdits] = React.useState<{ subject?: string; body?: string; text?: string }>({});
  const messages = useQuery({ queryKey: ["quote-messages", quote.id], queryFn: () => api<Messages>(`/api/v1/quotes/${quote.id}/messages`), enabled: open, staleTime: 0 });
  const subject = edits.subject ?? messages.data?.email.subject ?? "";
  const body = edits.body ?? messages.data?.email.body ?? "";
  const text = edits.text ?? messages.data?.whatsapp.text ?? "";
  const send = useMutation({
    mutationFn: () =>
      api<QuoteView>(`/api/v1/quotes/${quote.id}/send`, {
        method: "POST",
        json: channel === "EMAIL" ? { channel, subject, message: body } : channel === "WHATSAPP" ? { channel, message: text } : { channel },
      }),
    onSuccess: (view) => {
      queryClient.setQueryData(["quote", quote.id], view);
      for (const key of ["pipeline", "deal", "quotes", "lead-deals"]) void queryClient.invalidateQueries({ queryKey: [key] });
      toast.success(channel === "LINK" ? "Marked as sent — share the link with them" : `Quote sent by ${channel === "EMAIL" ? "email" : "WhatsApp"}`);
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const to = channel === "EMAIL" ? messages.data?.email.to : channel === "WHATSAPP" ? messages.data?.whatsapp.to : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{quote.status === "SENT" ? "Send again" : "Send quote"} {quote.number}</DialogTitle>
          <DialogDescription>
            {quote.lead.name} gets a link to view the quote, download the PDF and accept or decline online. The deal moves to Proposal at {money(quote.taxableTotal, quote.currency)} (before tax).
          </DialogDescription>
        </DialogHeader>
        <SegmentedControl
          size="sm"
          value={channel}
          onValueChange={setChannel}
          options={[
            { value: "EMAIL", label: <span className="inline-flex items-center gap-1.5"><Mail className="size-3.5" /> Email</span> },
            { value: "WHATSAPP", label: <span className="inline-flex items-center gap-1.5"><MessageCircle className="size-3.5" /> WhatsApp</span> },
            { value: "LINK", label: <span className="inline-flex items-center gap-1.5"><Link2 className="size-3.5" /> Share link</span> },
          ]}
        />
        {messages.isPending ? (
          <Skeleton className="h-48" />
        ) : messages.isError ? (
          <Callout tone="danger">{errorMessage(messages.error)}</Callout>
        ) : channel === "LINK" ? (
          <div className="grid gap-3">
            <Field>
              <Label>Quote link</Label>
              <div className="flex gap-2">
                <Input readOnly value={messages.data.link} className="font-mono text-xs" onFocus={(event) => event.target.select()} aria-label="Quote link" />
                <CopyButton value={messages.data.link} label="Link" />
              </div>
              <FieldHint>Anyone with the link can view and answer this quote.</FieldHint>
            </Field>
            <Field>
              <Label>WhatsApp-ready message</Label>
              <Textarea readOnly rows={8} value={messages.data.whatsapp.text} className="text-xs" aria-label="WhatsApp-ready message" />
              <div className="flex justify-end">
                <CopyButton value={messages.data.whatsapp.text} label="Message" />
              </div>
            </Field>
          </div>
        ) : (
          <div className="grid gap-3">
            <p className="text-xs text-foreground-muted">
              To: <span className="font-medium text-foreground">{to ?? "—"}</span>
            </p>
            {!to ? (
              <Callout tone="warning">
                {quote.lead.name} has no {channel === "EMAIL" ? "email address" : "WhatsApp number"}. Add one on the lead, or use Share link.
              </Callout>
            ) : null}
            {channel === "EMAIL" ? (
              <>
                <Field>
                  <Label htmlFor="send-subject">Subject</Label>
                  <Input id="send-subject" value={subject} onChange={(event) => setEdits({ ...edits, subject: event.target.value })} />
                </Field>
                <Field>
                  <Label htmlFor="send-body">Message</Label>
                  <Textarea id="send-body" rows={11} value={body} onChange={(event) => setEdits({ ...edits, body: event.target.value })} className="text-[13px]" />
                </Field>
              </>
            ) : (
              <>
                <Field>
                  <Label htmlFor="send-text">Message</Label>
                  <Textarea id="send-text" rows={10} value={text} onChange={(event) => setEdits({ ...edits, text: event.target.value })} className="text-[13px]" />
                </Field>
                <p className="text-[11px] text-foreground-muted">WhatsApp only delivers free-form messages within 24 hours of their last message. If the window is closed, copy the text from “Share link” and send it from your phone.</p>
              </>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={send.isPending} disabled={messages.isPending || (channel !== "LINK" && !to)} onClick={() => send.mutate()}>
            {channel === "LINK" ? <Check /> : <Send />} {channel === "LINK" ? "Mark as sent" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MarkDialog({ quote, decision, onClose }: { quote: QuoteView; decision: "accept" | "decline" | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [note, setNote] = React.useState("");
  const mark = useMutation({
    mutationFn: () => api<QuoteView>(`/api/v1/quotes/${quote.id}/mark`, { method: "POST", json: { decision, note: note.trim() || undefined } }),
    onSuccess: (view) => {
      queryClient.setQueryData(["quote", quote.id], view);
      for (const key of ["pipeline", "deal", "quotes", "tasks", "lead-deals"]) void queryClient.invalidateQueries({ queryKey: [key] });
      toast.success(decision === "accept" ? "Accepted — the deal is marked won" : "Marked declined — a follow-up task was created");
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Dialog open={decision !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{decision === "accept" ? "Record acceptance" : "Record decline"}</DialogTitle>
          <DialogDescription>
            {decision === "accept" ? `For when ${quote.lead.name} accepted by phone, email or in person. The deal is marked won at ${money(quote.taxableTotal, quote.currency)}.` : `The deal stays open and a follow-up task is created for tomorrow.`}
          </DialogDescription>
        </DialogHeader>
        <Field>
          <Label htmlFor="mark-note">Note (optional)</Label>
          <Textarea id="mark-note" rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder={decision === "accept" ? "Accepted on a call with Priya" : "Budget frozen until next quarter"} />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={decision === "accept" ? "primary" : "danger"} loading={mark.isPending} onClick={() => mark.mutate()}>
            {decision === "accept" ? "Mark accepted" : "Mark declined"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------- Status timeline

function StatusTrail({ quote }: { quote: QuoteView }) {
  const steps: Array<{ label: string; at: string | null; tone?: "good" | "bad" | "warn" }> = [
    { label: "Created", at: quote.createdAt },
    { label: "Sent", at: quote.sentAt },
    { label: "Viewed", at: quote.viewedAt },
    quote.status === "ACCEPTED"
      ? { label: `Accepted${quote.respondedByName ? ` by ${quote.respondedByName}` : ""}`, at: quote.acceptedAt, tone: "good" }
      : quote.status === "REJECTED"
        ? { label: `Declined${quote.respondedByName ? ` by ${quote.respondedByName}` : ""}`, at: quote.rejectedAt, tone: "bad" }
        : quote.status === "EXPIRED"
          ? { label: "Expired", at: quote.validUntil, tone: "warn" }
          : { label: "Answer", at: null },
  ];
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {steps.map((step, index) => (
        <li key={step.label} className="flex items-center gap-2">
          <span className={cn("inline-flex items-center gap-1.5", step.at ? "text-foreground" : "text-foreground-subtle")}>
            <span className={cn("size-1.5 rounded-full", !step.at ? "bg-border-strong" : step.tone === "good" ? "bg-good" : step.tone === "bad" ? "bg-critical" : step.tone === "warn" ? "bg-warning" : "bg-foreground")} />
            {step.label}
            {step.at ? (
              <span className="text-foreground-muted">
                <LocalTime value={step.at} style="date" />
              </span>
            ) : null}
          </span>
          {index < steps.length - 1 ? <span aria-hidden className="h-px w-4 bg-border-strong" /> : null}
        </li>
      ))}
    </ol>
  );
}

// ----------------------------------------------------------------------------- Editor

export function QuoteEditor({ initial, catalog, contacts }: { initial: QuoteView; catalog: EditorCatalog; contacts: Array<{ id: string; name: string | null; email: string | null; title: string | null }> }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const quoteQuery = useQuery({ queryKey: ["quote", initial.id], queryFn: () => api<QuoteView>(`/api/v1/quotes/${initial.id}`), initialData: initial });
  const quote = quoteQuery.data;
  const editable = canWrite && quote.status === "DRAFT";

  const [draft, setDraft] = React.useState<Draft>(() => draftFrom(initial));
  const [changes, setChanges] = React.useState(0);
  const [savedChanges, setSavedChanges] = React.useState(0);
  const [hints, dismissHints] = useDraftHints(initial.id);
  const [sending, setSending] = React.useState(false);
  const [marking, setMarking] = React.useState<"accept" | "decline" | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const edit = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setChanges((count) => count + 1);
  };

  const save = useMutation({
    mutationFn: (input: { body: ReturnType<typeof payload>; changes: number }) => api<QuoteView>(`/api/v1/quotes/${initial.id}`, { method: "PATCH", json: input.body }),
    onSuccess: (view, input) => {
      queryClient.setQueryData(["quote", initial.id], view);
      setSavedChanges((current) => Math.max(current, input.changes));
    },
    onError: (error) => toast.error(`Couldn't save: ${errorMessage(error)}`),
  });
  const saveNow = save.mutate;
  const unsaved = changes !== savedChanges;

  // Autosave shortly after typing stops.
  React.useEffect(() => {
    if (!editable || changes === savedChanges) return;
    const timer = window.setTimeout(() => saveNow({ body: payload(draft), changes }), 700);
    return () => window.clearTimeout(timer);
  }, [draft, changes, savedChanges, editable, saveNow]);

  React.useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  const duplicate = useMutation({
    mutationFn: () => api<{ id: string }>(`/api/v1/quotes/${quote.id}/duplicate`, { method: "POST" }),
    onSuccess: (copy) => {
      toast.success("Copied to a new draft");
      router.push(`/app/crm/quotes/${copy.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/v1/quotes/${quote.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Draft deleted");
      router.push("/app/crm?tab=quotes");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  // Live pricing with the same engine the server uses; the server re-prices on save.
  const priced = React.useMemo(() => priceQuote(draft.lines, catalog, { currency: quote.currency }), [draft.lines, catalog, quote.currency]);
  const issues = editable ? [...priced.issues, ...(draft.lines.length ? [] : ["Add at least one item"])] : [];
  const contact = contacts.find((item) => item.id === draft.contactId) ?? null;
  const taxRates = [...new Set(priced.lines.filter((line) => line.tax > 0).map((line) => line.taxRatePercent))];

  const doc: QuoteDoc = editable
    ? {
        ...quote,
        title: draft.title || null,
        notes: draft.notes || null,
        terms: draft.terms || null,
        validUntil: draft.validUntil ? `${draft.validUntil}T23:59:59` : null,
        contact: contact ? { name: contact.name, title: contact.title, email: contact.email } : null,
        ...priced.totals,
        taxLabel: quote.currency === "INR" ? (taxRates.length === 1 ? `GST ${taxRates[0]}%` : "GST") : taxRates.length === 1 ? `Tax ${taxRates[0]}%` : "Tax",
        lines: priced.lines.map((line) => ({ ...line, appliedRules: line.appliedRules })),
      }
    : quote;

  const hintFor = (line: LineInput) => (line.offeringId ? hints?.reasons.find((reason) => reason.offeringId === line.offeringId)?.reason : undefined);
  const activeOfferings = catalog.offerings.filter((offering) => offering.isActive);

  return (
    <div className="grid gap-5">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Link href="/app/crm?tab=quotes" className="inline-flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Quotes
          </Link>
          <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-[-0.01em]">{quote.number}</h1>
            <QuoteStatusBadge status={quote.status} viewed={Boolean(quote.viewedAt)} />
            {quote.generatedByAI ? (
              <Badge tone="accent">
                <Sparkles /> AI draft
              </Badge>
            ) : null}
            {editable ? <span className="text-xs text-foreground-muted">{save.isPending || unsaved ? "Saving…" : "All changes saved"}</span> : null}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-foreground-muted">
            <CompanyMark name={quote.lead.name} className="size-4 text-[8px]" />
            <Link href={`/app/leads/${quote.lead.id}`} className="hover:text-foreground hover:underline">
              {quote.lead.name}
            </Link>
            {quote.deal ? (
              <>
                <span>·</span>
                <Link href={`/app/crm?deal=${quote.deal.id}`} className="hover:text-foreground hover:underline">
                  Deal: {quote.deal.title}
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" asChild>
            <a href={`/api/v1/quotes/${quote.id}/pdf`} download>
              <Download /> PDF
            </a>
          </Button>
          {quote.status !== "DRAFT" ? (
            <Button size="sm" variant="secondary" asChild>
              <a href={quote.publicUrl} target="_blank" rel="noreferrer">
                <Eye /> Customer view <ExternalLink className="size-3" />
              </a>
            </Button>
          ) : null}
          {canWrite && quote.status === "SENT" ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => setMarking("decline")}>
                <ThumbsDown /> Declined
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setMarking("accept")}>
                <ThumbsUp /> Accepted
              </Button>
            </>
          ) : null}
          {canWrite && (quote.status === "DRAFT" || quote.status === "SENT") ? (
            <Button size="sm" variant="primary" disabled={issues.length > 0 || unsaved} onClick={() => setSending(true)}>
              <Send /> {quote.status === "SENT" ? "Send again" : "Send"}
            </Button>
          ) : null}
          {canWrite ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => duplicate.mutate()}>
                  <Copy /> Duplicate as new draft
                </DropdownMenuItem>
                {quote.status === "DRAFT" ? (
                  <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="text-danger-text">
                    <Trash2 /> Delete draft
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      {quote.status !== "DRAFT" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
          <StatusTrail quote={quote} />
          {quote.responseNote ? <p className="text-xs text-foreground-muted">“{quote.responseNote}”</p> : null}
          {quote.status === "SENT" && quote.expired ? <Badge tone="warning">Past its validity date</Badge> : null}
        </div>
      ) : null}

      {hints && editable ? (
        <Callout
          tone="accent"
          icon={Sparkles}
          action={
            <button
              type="button"
              className="text-xs font-medium text-accent hover:underline"
              onClick={dismissHints}
            >
              Dismiss
            </button>
          }
        >
          <p className="font-medium">Drafted from your conversation with {quote.lead.name}. Items and quantities are suggestions; every price comes from your catalog.</p>
          {hints.questions.length ? (
            <ul className="mt-1.5 grid gap-0.5 text-xs">
              {hints.questions.map((question) => (
                <li key={question}>• {question}</li>
              ))}
            </ul>
          ) : null}
        </Callout>
      ) : null}

      {editable ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* Editor column */}
          <div className="grid min-w-0 content-start gap-5">
            {issues.length ? (
              <Callout tone="warning" icon={CircleAlert}>
                <p className="font-medium">Fix before sending</p>
                <ul className="mt-1 grid gap-0.5 text-xs">
                  {[...new Set(issues)].map((issue) => (
                    <li key={issue}>• {issue}</li>
                  ))}
                </ul>
              </Callout>
            ) : null}

            <section className="grid gap-3 rounded-lg border border-border bg-surface p-4">
              <Field>
                <Label htmlFor="quote-title">Title</Label>
                <Input id="quote-title" value={draft.title} onChange={(event) => edit({ title: event.target.value })} placeholder={`Proposal for ${quote.lead.name}`} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <Label>Addressed to</Label>
                  <Select value={draft.contactId ?? "none"} onValueChange={(next) => edit({ contactId: next === "none" ? null : next })}>
                    <SelectTrigger aria-label="Addressed to">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{quote.lead.name} (no contact)</SelectItem>
                      {contacts.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name ?? item.email ?? "Unnamed"}
                          {item.title ? ` · ${item.title}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <Label htmlFor="quote-valid">Valid until</Label>
                  <Input id="quote-valid" type="date" value={draft.validUntil} onChange={(event) => edit({ validUntil: event.target.value })} />
                </Field>
              </div>
              <Field>
                <Label htmlFor="quote-notes">Cover note</Label>
                <Textarea id="quote-notes" rows={3} value={draft.notes} onChange={(event) => edit({ notes: event.target.value })} placeholder="A short, personal note that opens the quote." />
              </Field>
            </section>

            <section className="grid gap-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Items</h2>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="secondary">
                      <Plus /> Add item
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-72">
                    <DropdownMenuLabel>From your catalog</DropdownMenuLabel>
                    {activeOfferings.length === 0 ? <p className="px-2 py-1.5 text-xs text-foreground-muted">No catalog items yet — add them under Products & pricing.</p> : null}
                    {activeOfferings.map((offering) => (
                      <DropdownMenuItem key={offering.id} onSelect={() => edit({ lines: [...draft.lines, { offeringId: offering.id, quantity: offering.minOrderQuantity ?? 1 }] })}>
                        <Package />
                        <span className="min-w-0 flex-1 truncate">{offering.name}</span>
                        <span className="text-[11px] text-foreground-muted tabular">{offering.unitPrice === null ? "on request" : `${money(offering.unitPrice, catalog.currency)}/${offering.unit}`}</span>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => edit({ lines: [...draft.lines, { description: "", quantity: 1, unitPrice: null, taxRatePercent: catalog.currency === "INR" ? 18 : 0 }] })}>
                      <PenLine /> Custom line (you set the price)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {draft.lines.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
                  <FileText className="mx-auto size-5 text-foreground-subtle" />
                  <p className="mt-2 text-[13px] font-medium">No items yet</p>
                  <p className="mt-0.5 text-xs text-foreground-muted">Add products or services from your catalog — prices and discounts fill in automatically.</p>
                </div>
              ) : (
                <ul className="grid gap-2">
                  {draft.lines.map((line, index) => (
                    <LineCard
                      key={index}
                      line={line}
                      priced={priced.lines[index]!}
                      catalog={catalog}
                      hint={hintFor(line)}
                      onChange={(next) => edit({ lines: draft.lines.map((item, i) => (i === index ? next : item)) })}
                      onRemove={() => edit({ lines: draft.lines.filter((_, i) => i !== index) })}
                    />
                  ))}
                </ul>
              )}
              {draft.lines.length ? (
                <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 px-1 pt-1 text-[13px]">
                  <dt className="text-foreground-muted">Subtotal</dt>
                  <dd className="text-right tabular">{money(priced.totals.subtotal, catalog.currency, { decimals: 2 })}</dd>
                  {priced.totals.discountTotal ? (
                    <>
                      <dt className="text-foreground-muted">Discounts</dt>
                      <dd className="text-right text-success-text tabular">−{money(priced.totals.discountTotal, catalog.currency, { decimals: 2 })}</dd>
                    </>
                  ) : null}
                  <dt className="text-foreground-muted">Tax</dt>
                  <dd className="text-right tabular">{money(priced.totals.taxTotal, catalog.currency, { decimals: 2 })}</dd>
                  <dt className="border-t border-border pt-1.5 font-semibold">Total</dt>
                  <dd className="border-t border-border pt-1.5 text-right text-base font-semibold tabular">{money(priced.totals.total, catalog.currency, { decimals: 2 })}</dd>
                </dl>
              ) : null}
            </section>

            <section className="grid gap-2 rounded-lg border border-border bg-surface p-4">
              <Label htmlFor="quote-terms">Terms</Label>
              <Textarea id="quote-terms" rows={3} value={draft.terms} onChange={(event) => edit({ terms: event.target.value })} />
              <FieldHint>Defaults come from quote settings under Products & pricing.</FieldHint>
            </section>
          </div>

          {/* Preview column */}
          <div className="min-w-0">
            <div className="xl:sticky xl:top-4">
              <p className="mb-2 text-xs font-medium text-foreground-muted">Preview — what {quote.lead.name} sees</p>
              <QuoteDocument quote={doc} compact />
            </div>
          </div>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-3xl">
          <QuoteDocument quote={doc} />
        </div>
      )}

      {sending ? <SendDialog quote={quote} open onOpenChange={setSending} /> : null}
      <MarkDialog key={marking ?? "none"} quote={quote} decision={marking} onClose={() => setMarking(null)} />
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this draft?</DialogTitle>
            <DialogDescription>{quote.number} hasn’t been sent. Sent quotes are always kept for your records.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
              Delete draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
