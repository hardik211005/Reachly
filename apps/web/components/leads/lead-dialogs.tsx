"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileUp, Loader2, Plus, Upload } from "lucide-react";
import {
  Button,
  Callout,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  FieldHint,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@repo/ui";
import { api, ApiError, errorMessage } from "@/lib/api-client";

// ----------------------------------------------------------------------------- CSV parsing (preview only; the server re-parses)

function parseHeader(csv: string): { headers: string[]; sample: string[][]; rows: number } {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim());
  const split = (line: string) => {
    const cells: string[] = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (quoted && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else quoted = !quoted;
      } else if (char === "," && !quoted) {
        cells.push(current.trim());
        current = "";
      } else current += char;
    }
    cells.push(current.trim());
    return cells;
  };
  return { headers: split(lines[0] ?? ""), sample: lines.slice(1, 4).map(split), rows: Math.max(0, lines.length - 1) };
}

const FIELDS: Array<{ key: string; label: string; required?: boolean; guesses: string[] }> = [
  { key: "name", label: "Business name", required: true, guesses: ["name", "business", "company", "business name", "company name"] },
  { key: "website", label: "Website", guesses: ["website", "url", "domain", "site"] },
  { key: "email", label: "Email", guesses: ["email", "e-mail", "mail"] },
  { key: "phone", label: "Phone", guesses: ["phone", "mobile", "telephone", "contact number", "whatsapp"] },
  { key: "city", label: "City", guesses: ["city", "town", "location"] },
  { key: "category", label: "Category", guesses: ["category", "type", "industry", "segment"] },
  { key: "address", label: "Address", guesses: ["address", "street"] },
  { key: "contactName", label: "Contact name", guesses: ["contact", "contact name", "owner", "person"] },
  { key: "contactTitle", label: "Contact title", guesses: ["title", "designation", "role"] },
  { key: "notes", label: "Notes", guesses: ["notes", "note", "comments"] },
];

function guessMapping(headers: string[]): Record<string, string> {
  const lower = headers.map((header) => header.toLowerCase());
  const mapping: Record<string, string> = {};
  for (const field of FIELDS) {
    const index = lower.findIndex((header) => field.guesses.includes(header));
    if (index >= 0 && headers[index]) mapping[field.key] = headers[index];
  }
  return mapping;
}

interface ImportStatus {
  id: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  totalRows: number;
  importedRows: number;
  duplicateRows: number;
  failedRows: number;
  errors: Array<{ row: number; message: string }>;
}

export function ImportLeadsDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [file, setFile] = React.useState<{ name: string; csv: string } | null>(null);
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [importId, setImportId] = React.useState<string | null>(null);
  const preview = file ? parseHeader(file.csv) : null;

  const start = useMutation({
    mutationFn: () => api<{ id: string }>("/api/v1/leads/import", { method: "POST", json: { fileName: file?.name, csv: file?.csv, mapping } }),
    onSuccess: (job) => setImportId(job.id),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const status = useQuery({
    queryKey: ["import", importId],
    queryFn: () => api<ImportStatus>(`/api/v1/imports/${importId}`),
    enabled: Boolean(importId),
    refetchInterval: (query) => (query.state.data?.status === "COMPLETED" || query.state.data?.status === "FAILED" ? false : 1000),
  });

  function reset() {
    setFile(null);
    setMapping({});
    setImportId(null);
    start.reset();
  }

  async function onFile(selected: File | undefined) {
    if (!selected) return;
    if (selected.size > 2_000_000) {
      toast.error("CSV must be under 2 MB");
      return;
    }
    const csv = await selected.text();
    setFile({ name: selected.name, csv });
    setMapping(guessMapping(parseHeader(csv).headers));
  }

  const done = status.data?.status === "COMPLETED";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          if (done) void queryClient.invalidateQueries({ queryKey: ["leads"] });
          reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Upload /> Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Import leads from CSV</DialogTitle>
          <DialogDescription>Duplicates are detected by website, phone or name + city. Each new lead uses one lead credit.</DialogDescription>
        </DialogHeader>

        {importId ? (
          <div className="grid gap-3 py-2">
            {done ? (
              <Callout tone="success" icon={CheckCircle2} title={`${status.data?.importedRows ?? 0} leads imported`}>
                {status.data?.duplicateRows ?? 0} duplicates skipped{status.data?.failedRows ? `, ${status.data.failedRows} rows failed` : ""}. Leads are now being enriched and scored.
              </Callout>
            ) : (
              <div className="flex items-center gap-2 text-[13px]">
                <Loader2 className="size-4 animate-spin" /> Importing… {status.data?.importedRows ?? 0} of {status.data?.totalRows || preview?.rows || "?"}
              </div>
            )}
            {status.data?.errors.length ? (
              <ul className="max-h-32 overflow-y-auto rounded-md border border-border p-2 text-xs text-foreground-muted">
                {status.data.errors.slice(0, 20).map((error, index) => (
                  <li key={index}>
                    Row {error.row}: {error.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : !file ? (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong px-6 py-10 text-center transition-colors hover:bg-surface-muted">
            <FileUp className="size-6 text-foreground-muted" />
            <span className="text-[13px] font-medium">Choose a CSV file</span>
            <span className="text-xs text-foreground-muted">First row must contain column headers · max 5,000 rows</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => void onFile(event.target.files?.[0])} />
          </label>
        ) : (
          <div className="grid gap-4">
            <p className="text-[13px] text-foreground-secondary">
              <span className="font-medium text-foreground">{file.name}</span> · {preview?.rows ?? 0} rows
            </p>
            <div className="grid grid-cols-2 gap-3">
              {FIELDS.map((field) => (
                <Field key={field.key}>
                  <Label className="text-xs">
                    {field.label}
                    {field.required ? " *" : ""}
                  </Label>
                  <Select value={mapping[field.key] ?? "__none"} onValueChange={(value) => setMapping((current) => ({ ...current, [field.key]: value === "__none" ? "" : value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">— Skip —</SelectItem>
                      {preview?.headers.filter(Boolean).map((header) => (
                        <SelectItem key={header} value={header}>
                          {header}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ))}
            </div>
            <FieldHint>Only businesses you have a lawful basis to contact should be imported.</FieldHint>
          </div>
        )}

        <DialogFooter>
          {importId ? (
            <Button variant="primary" onClick={() => setOpen(false)}>
              {done ? "Done" : "Close"}
            </Button>
          ) : (
            <>
              {file ? (
                <Button variant="ghost" onClick={reset}>
                  Choose another file
                </Button>
              ) : null}
              <Button variant="primary" disabled={!file || !mapping.name} loading={start.isPending} onClick={() => start.mutate()}>
                Import {preview?.rows ? `${preview.rows} rows` : ""}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------- New lead

export function NewLeadDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", website: "", phone: "", email: "", city: "", category: "", contactName: "" });
  const [error, setError] = React.useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/api/v1/leads", {
        method: "POST",
        json: {
          name: form.name,
          website: form.website || null,
          phone: form.phone || null,
          email: form.email || null,
          city: form.city || null,
          category: form.category || null,
          contact: form.contactName ? { name: form.contactName, email: form.email || null, phone: form.phone || null } : undefined,
        },
      }),
    onSuccess: (lead) => {
      setOpen(false);
      router.push(`/app/leads/${lead.id}`);
    },
    onError: (err) => setError(err instanceof ApiError && err.code === "CONFLICT" ? err.message : errorMessage(err)),
  });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="primary">
          <Plus /> New lead
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a lead</DialogTitle>
          <DialogDescription>It will be enriched and scored automatically.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            if (form.name.trim().length < 2) return setError("Enter the business name");
            create.mutate();
          }}
        >
          <Field>
            <Label htmlFor="lead-name">Business name *</Label>
            <Input id="lead-name" value={form.name} onChange={set("name")} autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <Label htmlFor="lead-website">Website</Label>
              <Input id="lead-website" value={form.website} onChange={set("website")} placeholder="example.com" />
            </Field>
            <Field>
              <Label htmlFor="lead-city">City</Label>
              <Input id="lead-city" value={form.city} onChange={set("city")} />
            </Field>
            <Field>
              <Label htmlFor="lead-phone">Phone</Label>
              <Input id="lead-phone" value={form.phone} onChange={set("phone")} />
            </Field>
            <Field>
              <Label htmlFor="lead-email">Email</Label>
              <Input id="lead-email" type="email" value={form.email} onChange={set("email")} />
            </Field>
            <Field>
              <Label htmlFor="lead-category">Category</Label>
              <Input id="lead-category" value={form.category} onChange={set("category")} placeholder="cafe" />
            </Field>
            <Field>
              <Label htmlFor="lead-contact">Contact name</Label>
              <Input id="lead-contact" value={form.contactName} onChange={set("contactName")} />
            </Field>
          </div>
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <DialogFooter>
            <Button type="submit" variant="primary" loading={create.isPending}>
              Add lead
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
