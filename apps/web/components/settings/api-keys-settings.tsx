"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Lock, Plus, Terminal, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import { Badge, Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, ErrorState, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, Spinner, toast } from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { useCanManage } from "../shell/shell-context";
import { Section } from "./kit";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const SCOPES = [
  { value: "read", label: "Read", description: "List and fetch leads, campaigns, deals and analytics" },
  { value: "write", label: "Write", description: "Create and update records, start runs" },
];
const EXPIRY = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "Never" },
];

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        });
      }}
    >
      {copied ? <Check className="text-good" /> : <Copy />} {copied ? "Copied" : label}
    </Button>
  );
}

function CreateKeyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = React.useState("");
  const [scopes, setScopes] = React.useState<string[]>(["read"]);
  const [expiry, setExpiry] = React.useState("90");
  const [created, setCreated] = React.useState<{ key: string; name: string } | null>(null);
  const create = useMutation({
    mutationFn: () => api<{ key: string; name: string }>("/api/v1/api-keys", { method: "POST", json: { name, scopes, expiresInDays: expiry === "never" ? null : Number(expiry) } }),
    onSuccess: (result) => {
      setCreated(result);
      void queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setCreated(null);
      setName("");
      setScopes(["read"]);
      setExpiry("90");
    }
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Copy your new key</DialogTitle>
              <DialogDescription>This is the only time it will be shown. Store it somewhere safe, like a secrets manager.</DialogDescription>
            </DialogHeader>
            <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="grid gap-3">
              <code className="block rounded-lg border border-border bg-surface-muted px-3 py-2.5 font-mono text-[12.5px] break-all">{created.key}</code>
              <p className="flex items-start gap-2 text-[12.5px] text-warning-text">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> Anyone with this key can act on your workspace within its scopes.
              </p>
            </motion.div>
            <DialogFooter>
              <CopyButton value={created.key} label="Copy key" />
              <Button variant="primary" onClick={() => close(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim() && scopes.length) create.mutate();
            }}
          >
            <DialogHeader>
              <DialogTitle>Create an API key</DialogTitle>
              <DialogDescription>Keys act as this workspace. Give each integration its own key so you can revoke it alone.</DialogDescription>
            </DialogHeader>
            <div className="mt-4 grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="api-key-name">Name</Label>
                <Input id="api-key-name" value={name} maxLength={60} placeholder="e.g. Zapier, internal dashboard" onChange={(event) => setName(event.target.value)} />
              </div>
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-[13px] font-medium">Scopes</legend>
                {SCOPES.map((scope) => (
                  <label key={scope.value} className="flex items-start gap-2.5 rounded-lg border border-border p-3 text-[13px]">
                    <Checkbox checked={scopes.includes(scope.value)} onCheckedChange={(checked) => setScopes((current) => (checked ? [...new Set([...current, scope.value])] : current.filter((item) => item !== scope.value)))} className="mt-0.5" />
                    <span>
                      <span className="font-medium">{scope.label}</span>
                      <span className="block text-[12px] text-foreground-muted">{scope.description}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="grid gap-1.5">
                <Label>Expires</Label>
                <Select value={expiry} onValueChange={setExpiry}>
                  <SelectTrigger aria-label="Expiry">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter className="mt-5">
              <Button variant="secondary" type="button" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={!name.trim() || !scopes.length || create.isPending}>
                {create.isPending ? <Spinner className="size-3.5" /> : null} Create key
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

const subscribeNever = () => () => {};

function status(key: ApiKey) {
  if (key.revokedAt) return { label: "Revoked", tone: "neutral" as const };
  if (key.expiresAt && new Date(key.expiresAt) < new Date()) return { label: "Expired", tone: "warning" as const };
  return { label: "Active", tone: "success" as const };
}

export function ApiKeysSettings() {
  const queryClient = useQueryClient();
  const canManage = useCanManage();
  const [open, setOpen] = React.useState(false);
  const keys = useQuery({ queryKey: ["api-keys"], queryFn: () => api<{ keys: ApiKey[]; apiAccess: boolean }>("/api/v1/api-keys"), enabled: canManage });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/v1/api-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Key revoked. Requests using it now fail.");
      void queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const origin = React.useSyncExternalStore(subscribeNever, () => window.location.origin, () => "");

  if (!canManage) {
    return (
      <Section title="API keys" icon={KeyRound}>
        <EmptyState compact icon={Lock} title="Admins only" description="Ask a workspace admin to create a key for you." />
      </Section>
    );
  }

  const locked = keys.data ? !keys.data.apiAccess : false;
  const list = keys.data?.keys ?? [];
  const active = list.filter((key) => !key.revokedAt);
  return (
    <>
      <Section
        title="API keys"
        description="Use the REST API to read and write your workspace data from other tools."
        icon={KeyRound}
        footer={
          <Button variant="primary" size="sm" onClick={() => setOpen(true)} disabled={locked}>
            <Plus /> Create key
          </Button>
        }
      >
        {keys.isError ? (
          <ErrorState description={errorMessage(keys.error)} onRetry={() => void keys.refetch()} />
        ) : keys.isPending ? (
          <Skeleton className="h-24" />
        ) : active.length === 0 ? (
          <EmptyState compact icon={KeyRound} title="No keys yet" description="Create one for each integration that needs access." />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((key) => {
              const state = status(key);
              return (
                <li key={key.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-surface-muted">
                    <KeyRound className="size-4 text-foreground-muted" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-[13.5px] font-medium">
                      {key.name} <Badge tone={state.tone}>{state.label}</Badge>
                      {key.scopes.map((scope) => (
                        <Badge key={scope} tone="outline">
                          {scope}
                        </Badge>
                      ))}
                    </p>
                    <p className="text-[12px] text-foreground-muted">
                      <span className="font-mono">{key.prefix}…</span> · created {new Date(key.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })} · {key.lastUsedAt ? `last used ${new Date(key.lastUsedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}` : "never used"}
                      {key.expiresAt ? ` · expires ${new Date(key.expiresAt).toLocaleDateString(undefined, { dateStyle: "medium" })}` : ""}
                    </p>
                  </div>
                  {key.revokedAt ? null : (
                    <Button variant="ghost" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(key.id)}>
                      Revoke
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {locked ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-muted/60 px-4 py-3">
            <p className="flex items-center gap-2 text-[13px] text-foreground-secondary">
              <Lock className="size-4 text-foreground-muted" /> API access isn&apos;t included in your current plan.
            </p>
            <Button asChild variant="secondary" size="sm">
              <Link href="/app/billing">See plans</Link>
            </Button>
          </div>
        ) : null}
      </Section>
      <Section title="Quick start" description="Send the key as a bearer token." icon={Terminal}>
        <pre className="overflow-x-auto rounded-lg bg-foreground px-4 py-3 font-mono text-[12px] leading-relaxed text-background">
          {`curl ${origin}/api/v1/leads?pageSize=5 \\\n  -H "Authorization: Bearer rk_live_…"`}
        </pre>
        <p className="mt-3 text-[12.5px] text-foreground-muted">Responses are JSON: {"{ data, meta }"} on success and {"{ error: { code, message } }"} on failure. Requests are rate limited.</p>
      </Section>
      <CreateKeyDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
