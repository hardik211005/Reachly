"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Eye, LogOut, Mail, MoreHorizontal, RotateCw, Send, ShieldCheck, UserMinus, UserPlus, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import type { MemberRole } from "@repo/config";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ErrorState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
  cn,
  toast,
} from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { useCanManage } from "../shell/shell-context";
import { Section } from "./kit";

interface Team {
  members: Array<{ id: string; role: MemberRole; joinedAt: string; isYou: boolean; user: { id: string; name: string; email: string; image: string | null } }>;
  invitations: Array<{ id: string; email: string; role: MemberRole; expiresAt: string; createdAt: string; invitedBy: string | null }>;
  seats: { used: number; limit: number | null };
  assignableRoles: MemberRole[];
}

const ROLE_META: Record<MemberRole, { label: string; description: string; icon: React.ComponentType<{ className?: string }> }> = {
  OWNER: { label: "Owner", description: "Everything, including billing and removing owners", icon: Crown },
  ADMIN: { label: "Admin", description: "Settings, team, integrations and compliance", icon: ShieldCheck },
  MEMBER: { label: "Member", description: "Find leads, run campaigns, calls and deals", icon: Users },
  VIEWER: { label: "Viewer", description: "Read-only access", icon: Eye },
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function SeatsBar({ used, limit }: { used: number; limit: number | null }) {
  const percent = limit ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="min-w-44">
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="text-foreground-muted">Seats</span>
        <span className="font-medium tabular">
          {used} / {limit ?? "∞"}
        </span>
      </div>
      {limit ? (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
          <motion.div className={cn("h-full rounded-full", percent >= 100 ? "bg-warning" : "bg-brand-gradient")} initial={{ width: 0 }} animate={{ width: `${percent}%` }} transition={{ duration: 0.7 }} />
        </div>
      ) : null}
    </div>
  );
}

function InviteForm({ team }: { team: Team }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<MemberRole>(team.assignableRoles.includes("MEMBER") ? "MEMBER" : (team.assignableRoles[0] ?? "VIEWER"));
  const full = team.seats.limit !== null && team.seats.used >= team.seats.limit;
  const invite = useMutation({
    mutationFn: () => api("/api/v1/team/invitations", { method: "POST", json: { email, role } }),
    onSuccess: () => {
      toast.success(`Invitation sent to ${email}`);
      setEmail("");
      void queryClient.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (email) invite.mutate();
      }}
    >
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px_auto]">
        <div className="relative">
          <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-muted" />
          <Input type="email" aria-label="Email address" placeholder="teammate@company.com" value={email} onChange={(event) => setEmail(event.target.value)} className="pl-9" disabled={full} />
        </div>
        <Select value={role} onValueChange={(value) => setRole(value as MemberRole)} disabled={full}>
          <SelectTrigger aria-label="Role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {team.assignableRoles.map((option) => (
              <SelectItem key={option} value={option}>
                {ROLE_META[option].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" variant="primary" disabled={!email || invite.isPending || full}>
          {invite.isPending ? <Spinner className="size-3.5" /> : <Send />} Send invite
        </Button>
      </div>
      <p className="text-[12px] text-foreground-muted">
        {full ? (
          <>
            All seats on your plan are in use.{" "}
            <Link href="/app/billing" className="font-medium text-foreground underline-offset-2 hover:underline">
              Upgrade for more
            </Link>
            .
          </>
        ) : (
          <>
            {ROLE_META[role].label}: {ROLE_META[role].description.toLowerCase()}. The link expires in 7 days.
          </>
        )}
      </p>
    </form>
  );
}

function MemberRow({ member, team, canManage, onRemove }: { member: Team["members"][number]; team: Team; canManage: boolean; onRemove: (member: Team["members"][number]) => void }) {
  const queryClient = useQueryClient();
  const changeRole = useMutation({
    mutationFn: (role: MemberRole) => api(`/api/v1/team/members/${member.id}`, { method: "PATCH", json: { role } }),
    onSuccess: () => {
      toast.success("Role updated");
      void queryClient.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const RoleIcon = ROLE_META[member.role].icon;
  const editable = canManage && !member.isYou && (member.role !== "OWNER" || team.assignableRoles.includes("OWNER"));
  return (
    <motion.li layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -12 }} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <span className="bg-brand-gradient flex size-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white">{initials(member.user.name)}</span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-[13.5px] font-medium">
          {member.user.name} {member.isYou ? <Badge tone="accent">You</Badge> : null}
        </p>
        <p className="truncate text-[12px] text-foreground-muted">
          {member.user.email} · joined {new Date(member.joinedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
        </p>
      </div>
      {editable ? (
        <Select value={member.role} onValueChange={(value) => changeRole.mutate(value as MemberRole)} disabled={changeRole.isPending}>
          <SelectTrigger className="h-8 w-32" aria-label={`Role for ${member.user.name}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {team.assignableRoles.map((role) => (
              <SelectItem key={role} value={role}>
                {ROLE_META[role].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="inline-flex h-8 items-center gap-1.5 rounded-md bg-surface-muted px-2.5 text-[12px] font-medium text-foreground-secondary">
          <RoleIcon className="size-3.5" /> {ROLE_META[member.role].label}
        </span>
      )}
      {editable ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`More for ${member.user.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="text-danger-text" onSelect={() => onRemove(member)}>
              <UserMinus /> Remove from workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="w-8" />
      )}
    </motion.li>
  );
}

export function TeamSettings() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const canManage = useCanManage();
  const team = useQuery({ queryKey: ["team"], queryFn: () => api<Team>("/api/v1/team") });
  const [removing, setRemoving] = React.useState<Team["members"][number] | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/v1/team/members/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => {
      const leaving = team.data?.members.find((member) => member.id === id)?.isYou;
      setRemoving(null);
      if (leaving) {
        toast.success("You left the workspace");
        router.push("/app");
        router.refresh();
        return;
      }
      toast.success("Member removed");
      void queryClient.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/v1/team/invitations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Invitation withdrawn");
      void queryClient.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const resend = useMutation({
    mutationFn: (invitation: Team["invitations"][number]) => api("/api/v1/team/invitations", { method: "POST", json: { email: invitation.email, role: invitation.role } }),
    onSuccess: (_, invitation) => {
      toast.success(`New invitation sent to ${invitation.email}`);
      void queryClient.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (team.isError) return <ErrorState description={errorMessage(team.error)} onRetry={() => void team.refetch()} />;
  if (!team.data) return <Skeleton className="h-96 rounded-xl" />;
  const me = team.data.members.find((member) => member.isYou);

  return (
    <>
      {canManage ? (
        <Section title="Invite teammates" description="They'll get an email with a link to join this workspace." icon={UserPlus}>
          <div className="mb-4 flex justify-end">
            <SeatsBar used={team.data.seats.used} limit={team.data.seats.limit} />
          </div>
          <InviteForm team={team.data} />
        </Section>
      ) : null}
      <Section title={`Members · ${team.data.members.length}`} description="Everyone with access to this workspace." icon={Users}>
        <ul className="divide-y divide-border">
          <AnimatePresence initial={false}>
            {team.data.members.map((member) => (
              <MemberRow key={member.id} member={member} team={team.data} canManage={canManage} onRemove={setRemoving} />
            ))}
          </AnimatePresence>
        </ul>
      </Section>
      {team.data.invitations.length ? (
        <Section title={`Pending invitations · ${team.data.invitations.length}`} description="Waiting for someone to accept." icon={Mail}>
          <ul className="divide-y divide-border">
            {team.data.invitations.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="flex size-9 items-center justify-center rounded-full border border-dashed border-border-strong">
                  <Mail className="size-4 text-foreground-muted" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium">{invitation.email}</p>
                  <p className="text-[12px] text-foreground-muted">
                    {ROLE_META[invitation.role].label} · {invitation.invitedBy ? `invited by ${invitation.invitedBy} · ` : ""}expires {new Date(invitation.expiresAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
                  </p>
                </div>
                {canManage ? (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" disabled={resend.isPending} onClick={() => resend.mutate(invitation)}>
                      <RotateCw /> Resend
                    </Button>
                    <Button variant="ghost" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(invitation.id)}>
                      Withdraw
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section title="Roles" description="What each role can do." icon={ShieldCheck}>
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(ROLE_META) as MemberRole[]).map((role) => {
            const meta = ROLE_META[role];
            return (
              <div key={role} className="flex gap-3 rounded-lg border border-border p-3">
                <meta.icon className="mt-0.5 size-4 text-brand-1" />
                <div>
                  <p className="text-[13px] font-semibold">{meta.label}</p>
                  <p className="text-[12.5px] text-foreground-muted">{meta.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </Section>
      {me ? (
        <Section title="Leave workspace" description="You'll lose access until someone invites you again." icon={LogOut} tone="danger">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-foreground-secondary">{me.role === "OWNER" ? "If you're the only owner, make someone else an owner first." : "Your leads and activity stay with the workspace."}</p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm">
                  <LogOut /> Leave…
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="text-danger-text" onSelect={() => remove.mutate(me.id)}>
                  Yes, leave this workspace
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Cancel</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </Section>
      ) : null}
      <Dialog open={Boolean(removing)} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removing?.user.name}?</DialogTitle>
            <DialogDescription>They&apos;ll lose access straight away. Their leads, messages and deals stay in the workspace.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={remove.isPending} onClick={() => removing && remove.mutate(removing.id)}>
              {remove.isPending ? <Spinner className="size-3.5" /> : null} Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
