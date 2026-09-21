"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, FileText, FlaskConical, Plus, RefreshCw, ShieldCheck, Trash2, XCircle } from "lucide-react";
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
  Textarea,
  Tooltip,
  toast,
} from "@repo/ui";
import { apiWithMeta, api, errorMessage } from "@/lib/api-client";
import { useCanWrite } from "../shell/shell-context";
import { RelativeTime } from "../time";
import { ChannelDashboard, ProviderCard } from "./channel-dashboard";

interface Template {
  id: string;
  name: string;
  language: string;
  category: string;
  body: string;
  variables: string[];
  status: string;
  provider: string;
  syncedAt: string | null;
  _count: { steps: number };
}

const TEMPLATE_VARIABLE_OPTIONS = ["first_name", "business_name", "sender_name", "sender_company", "offer_short", "locality", "call_to_action"];

function TemplateStatus({ status }: { status: string }) {
  if (status === "APPROVED")
    return (
      <Badge tone="success">
        <CheckCircle2 /> Approved
      </Badge>
    );
  if (status === "REJECTED")
    return (
      <Badge tone="danger">
        <XCircle /> Rejected
      </Badge>
    );
  return (
    <Badge tone="warning">
      <Clock /> {status.charAt(0) + status.slice(1).toLowerCase()}
    </Badge>
  );
}

/** Template body with {{1}}… placeholders labelled by their mapped variable. */
function TemplateBody({ body, variables }: { body: string; variables: string[] }) {
  const parts = body.split(/(\{\{\d+\}\})/g);
  return (
    <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-foreground-secondary">
      {parts.map((part, index) => {
        const match = /^\{\{(\d+)\}\}$/.exec(part);
        if (!match) return <span key={index}>{part}</span>;
        const variable = variables[Number(match[1]) - 1];
        return (
          <span key={index} className="rounded-[3px] bg-accent-soft px-1 font-mono text-[11px] text-accent-soft-foreground">
            {variable ?? part}
          </span>
        );
      })}
    </p>
  );
}

function NewTemplateDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [category, setCategory] = React.useState("MARKETING");
  const [body, setBody] = React.useState("Hi {{1}}, this is {{2}} from {{3}}. Would you be open to a quick chat about {{4}}? Reply STOP to opt out.");
  const placeholders = Math.max(0, ...[...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])));
  const [variables, setVariables] = React.useState<string[]>(["first_name", "sender_name", "sender_company", "offer_short"]);
  const mapped = Array.from({ length: placeholders }, (_, index) => variables[index] ?? "");

  const create = useMutation({
    mutationFn: () => api("/api/v1/whatsapp/templates", { method: "POST", json: { name, category, body, language: "en", variables: mapped } }),
    onSuccess: () => {
      toast.success("Demo template added");
      setOpen(false);
      setName("");
      void queryClient.invalidateQueries({ queryKey: ["whatsapp-templates"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus /> Demo template
      </Button>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a demo template</DialogTitle>
          <DialogDescription>For demo mode only. With a real WhatsApp Business Account, templates are created in WhatsApp Manager, reviewed by Meta and synced here.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_150px]">
            <Field>
              <Label htmlFor="template-name">Name</Label>
              <Input id="template-name" value={name} onChange={(event) => setName(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} placeholder="intro_offer" />
              <FieldHint>Lowercase and underscores, like Meta requires.</FieldHint>
            </Field>
            <Field>
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger aria-label="Category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MARKETING">Marketing</SelectItem>
                  <SelectItem value="UTILITY">Utility</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field>
            <Label htmlFor="template-body">Body</Label>
            <Textarea id="template-body" rows={4} value={body} onChange={(event) => setBody(event.target.value)} />
            <FieldHint>Use {"{{1}}"}, {"{{2}}"}… for personalised values. Include an opt-out line.</FieldHint>
          </Field>
          {placeholders ? (
            <div className="grid gap-2">
              <Label>Fill placeholders with</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {mapped.map((variable, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <span className="w-9 shrink-0 font-mono text-xs text-foreground-muted">{`{{${index + 1}}}`}</span>
                    <Select
                      value={variable || undefined}
                      onValueChange={(value) =>
                        setVariables((current) => {
                          const next = [...current];
                          next[index] = value;
                          return next;
                        })
                      }
                    >
                      <SelectTrigger className="h-8 text-xs" aria-label={`Placeholder ${index + 1}`}>
                        <SelectValue placeholder="Choose…" />
                      </SelectTrigger>
                      <SelectContent>
                        {TEMPLATE_VARIABLE_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!name || !body.trim() || mapped.some((value) => !value) || create.isPending} onClick={() => create.mutate()}>
            Add template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplatesSection() {
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const query = useQuery({
    queryKey: ["whatsapp-templates"],
    queryFn: () => apiWithMeta<Template[], { provider: { ok: boolean; name: string | null; simulated: boolean } }>("/api/v1/whatsapp/templates"),
  });
  const sync = useMutation({
    mutationFn: () => api<{ synced: number; simulated: boolean }>("/api/v1/whatsapp/templates/sync", { method: "POST" }),
    onSuccess: (result) => {
      toast.success(`${result.synced} template${result.synced === 1 ? "" : "s"} synced${result.simulated ? " from the demo provider" : ""}`);
      void queryClient.invalidateQueries({ queryKey: ["whatsapp-templates"] });
      void queryClient.invalidateQueries({ queryKey: ["channel-overview"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/v1/whatsapp/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["whatsapp-templates"] }),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const provider = query.data?.meta.provider;
  const templates = query.data?.data ?? [];
  return (
    <section className="rounded-lg border border-border bg-surface shadow-xs">
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 pt-3.5 pb-3">
        <div>
          <h3 className="text-[13px] font-semibold">Message templates</h3>
          <p className="mt-0.5 text-xs text-foreground-muted">Business-initiated messages must use a template approved by Meta.</p>
        </div>
        {canWrite && provider?.ok ? (
          <div className="flex items-center gap-2">
            {provider.simulated ? <NewTemplateDialog /> : null}
            <Button size="sm" variant="secondary" onClick={() => sync.mutate()} disabled={sync.isPending}>
              <RefreshCw className={sync.isPending ? "animate-spin" : undefined} /> Sync templates
            </Button>
          </div>
        ) : null}
      </header>
      {query.isPending ? (
        <div className="grid gap-2 px-4 pb-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : templates.length ? (
        <ul className="divide-y divide-border border-t border-border">
          {templates.map((template) => (
            <li key={template.id} className="grid gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12.5px] font-medium">{template.name}</span>
                <TemplateStatus status={template.status} />
                <Badge tone="outline">{template.category.toLowerCase()}</Badge>
                <span className="text-xs text-foreground-muted">{template.language}</span>
                {template.provider === "mock" ? (
                  <Tooltip content="Demo template — only usable with the simulated WhatsApp provider">
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-warning-text">
                      <FlaskConical className="size-3" /> Demo
                    </span>
                  </Tooltip>
                ) : null}
                <span className="ml-auto flex items-center gap-2 text-[11px] text-foreground-muted">
                  {template._count.steps ? `Used in ${template._count.steps} step${template._count.steps === 1 ? "" : "s"}` : "Unused"}
                  {template.syncedAt ? (
                    <>
                      · synced <RelativeTime value={template.syncedAt} />
                    </>
                  ) : null}
                  {canWrite && !template._count.steps ? (
                    <Button size="icon-xs" variant="ghost" aria-label={`Delete ${template.name}`} onClick={() => window.confirm(`Delete ${template.name}?`) && remove.mutate(template.id)}>
                      <Trash2 />
                    </Button>
                  ) : null}
                </span>
              </div>
              <TemplateBody body={template.body} variables={template.variables} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          compact
          icon={FileText}
          title="No templates yet"
          description={provider?.ok ? "Sync approved templates from your WhatsApp Business Account." : "Connect WhatsApp to sync approved templates."}
          action={
            canWrite && provider?.ok ? (
              <Button size="sm" variant="primary" onClick={() => sync.mutate()} disabled={sync.isPending}>
                <RefreshCw /> Sync templates
              </Button>
            ) : null
          }
        />
      )}
    </section>
  );
}

export function WhatsAppView({ requireOptIn }: { requireOptIn: boolean }) {
  return (
    <ChannelDashboard
      channel="WHATSAPP"
      labels={{ engaged: "Read", replied: "Reply rate" }}
      aside={(data) => (
        <>
          <ProviderCard title="WhatsApp Business API" provider={data.provider}>
            <p className="mt-3 text-xs leading-relaxed text-foreground-muted">Only the official WhatsApp Cloud API is supported — no unofficial automation, which risks number bans.</p>
          </ProviderCard>
          <section className="rounded-lg border border-border bg-surface p-4 shadow-xs">
            <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
              <ShieldCheck className="size-3.5 text-success-text" /> Policy guardrails
            </h3>
            <ul className="mt-3 grid gap-2.5 text-[13px] text-foreground-secondary">
              <li>
                <span className="font-medium text-foreground">Opt-in {requireOptIn ? "required" : "not enforced"}.</span> Business-initiated messages go only to contacts with recorded WhatsApp opt-in.
              </li>
              <li>
                <span className="font-medium text-foreground">24-hour window.</span> Free-form replies are allowed for 24 hours after the customer’s last message; after that, only approved templates.
              </li>
              <li>
                <span className="font-medium text-foreground">Opt-outs are instant.</span> “STOP” and similar replies suppress the number across every campaign.
              </li>
            </ul>
          </section>
        </>
      )}
    >
      {() => <TemplatesSection />}
    </ChannelDashboard>
  );
}
