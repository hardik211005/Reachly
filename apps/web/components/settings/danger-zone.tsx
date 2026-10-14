"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileJson, Trash2, UserX } from "lucide-react";
import { Button, Callout, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Skeleton, Spinner, toast } from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { useShell } from "../shell/shell-context";
import { Section } from "./kit";

// ----------------------------------------------------------------------------- Export

/** Downloads everything the workspace owns as one JSON file (no secrets). */
export function ExportDataSection() {
  const { role } = useShell();
  const [pending, setPending] = React.useState(false);
  if (role !== "OWNER" && role !== "ADMIN") return null;

  const download = async () => {
    setPending(true);
    try {
      const response = await fetch("/api/v1/workspace/export");
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "Export failed");
      }
      const blob = await response.blob();
      const filename = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "reachly-export.json";
      const url = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement("a"), { href: url, download: filename });
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <Section title="Export your data" description="Everything in this workspace — leads, contacts, campaigns, messages, calls, deals, quotes, workflows, settings and the activity log — as one JSON file." icon={FileJson}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-foreground-muted">Provider credentials, webhook secrets and API keys are never included.</p>
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => void download()}>
          {pending ? <Spinner className="size-3.5" /> : <Download />} Download export
        </Button>
      </div>
    </Section>
  );
}

// ----------------------------------------------------------------------------- Delete workspace

export function DeleteWorkspaceSection() {
  const { role, workspace } = useShell();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const remove = useMutation({
    mutationFn: () => api<{ purgeAfterDays: number }>("/api/v1/workspace", { method: "DELETE", json: { confirmName: typed } }),
    onSuccess: () => {
      toast.success(`“${workspace.name}” was deleted`);
      // Drop cached data from the deleted workspace; the layout re-resolves to another one or onboarding.
      queryClient.clear();
      router.push("/app");
      router.refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  if (role !== "OWNER") return null;
  const matches = typed.trim() === workspace.name.trim();

  return (
    <Section title="Delete workspace" description="Removes this workspace for everyone in it." icon={Trash2} tone="danger">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-[12.5px] leading-relaxed text-foreground-muted">
          Members lose access immediately and API keys stop working. Data is kept for 30 days in case you change your mind (contact support to restore), then deleted for good. Cancel any paid plan first.
        </p>
        <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
          <Trash2 /> Delete workspace
        </Button>
      </div>
      <Dialog open={open} onOpenChange={(next) => !remove.isPending && (setOpen(next), setTyped(""))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{workspace.name}”?</DialogTitle>
            <DialogDescription>Everyone loses access right away. Consider downloading an export first.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="confirm-workspace">
              Type <span className="font-semibold">{workspace.name}</span> to confirm
            </Label>
            <Input id="confirm-workspace" autoComplete="off" value={typed} onChange={(event) => setTyped(event.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={remove.isPending}>
              Cancel
            </Button>
            <Button variant="danger" disabled={!matches || remove.isPending} onClick={() => remove.mutate()}>
              {remove.isPending ? <Spinner className="size-3.5" /> : <Trash2 />} Delete workspace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

// ----------------------------------------------------------------------------- Delete account

interface DeletionPlan {
  deletesWorkspaces: Array<{ id: string; name: string }>;
  leaves: Array<{ id: string; name: string }>;
  blocking: Array<{ id: string; name: string }>;
}

export function DeleteAccountSection() {
  const { user } = useShell();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const plan = useQuery({ queryKey: ["account-deletion"], queryFn: () => api<DeletionPlan>("/api/v1/me/deletion"), enabled: open });
  const remove = useMutation({
    mutationFn: () => api("/api/v1/me", { method: "DELETE", json: { confirmEmail: typed } }),
    onSuccess: () => {
      queryClient.clear();
      router.push("/");
      router.refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const matches = typed.trim().toLowerCase() === user.email.toLowerCase();
  const blocked = Boolean(plan.data?.blocking.length);

  return (
    <Section title="Delete account" description="Permanently removes your login and personal details." icon={UserX} tone="danger">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-[12.5px] leading-relaxed text-foreground-muted">You&apos;ll be signed out everywhere. Workspaces where you&apos;re the only member are deleted too; in shared workspaces your records stay, without your name.</p>
        <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
          <UserX /> Delete account
        </Button>
      </div>
      <Dialog open={open} onOpenChange={(next) => !remove.isPending && (setOpen(next), setTyped(""))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>This can&apos;t be undone.</DialogDescription>
          </DialogHeader>
          {!plan.data ? (
            <Skeleton className="h-16 rounded-lg" />
          ) : blocked ? (
            <Callout tone="danger" title="Hand over ownership first">
              You&apos;re the only owner of {plan.data.blocking.map((item) => `“${item.name}”`).join(", ")}, which other people use. Make someone else an owner in Team settings, or delete the workspace, then come back.
            </Callout>
          ) : (
            <div className="grid gap-3 text-[13px]">
              {plan.data.deletesWorkspaces.length ? (
                <Callout tone="warning" title={`${plan.data.deletesWorkspaces.length === 1 ? "This workspace is" : "These workspaces are"} deleted with your account`}>
                  {plan.data.deletesWorkspaces.map((item) => item.name).join(", ")} — you&apos;re the only member.
                </Callout>
              ) : null}
              {plan.data.leaves.length ? <p className="text-foreground-secondary">You&apos;ll leave {plan.data.leaves.map((item) => item.name).join(", ")}.</p> : null}
              <div className="grid gap-2">
                <Label htmlFor="confirm-email">
                  Type <span className="font-semibold">{user.email}</span> to confirm
                </Label>
                <Input id="confirm-email" type="email" autoComplete="off" value={typed} onChange={(event) => setTyped(event.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={remove.isPending}>
              Cancel
            </Button>
            <Button variant="danger" disabled={!plan.data || blocked || !matches || remove.isPending} onClick={() => remove.mutate()}>
              {remove.isPending ? <Spinner className="size-3.5" /> : <UserX />} Delete account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
