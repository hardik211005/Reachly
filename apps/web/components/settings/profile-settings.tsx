"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { KeyRound, Laptop, LogOut, Monitor, Moon, Palette, Smartphone, Sun, UserRound } from "lucide-react";
import { motion } from "motion/react";
import { Badge, Button, Checkbox, ErrorState, Input, Label, Skeleton, Spinner, cn, toast } from "@repo/ui";
import { authClient } from "@/lib/auth-client";
import { useShell } from "../shell/shell-context";
import { Row, SaveBar, Section } from "./kit";

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function ProfileSection() {
  const router = useRouter();
  const { user } = useShell();
  const [name, setName] = React.useState(user.name);
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.updateUser({ name: name.trim() });
      if (error) throw new Error(error.message ?? "Could not update your name");
    },
    onSuccess: () => {
      toast.success("Profile updated");
      router.refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const dirty = name.trim() !== user.name;
  return (
    <Section title="Profile" description="How you appear to teammates." icon={UserRound} footer={<SaveBar dirty={dirty} pending={save.isPending} onSave={() => save.mutate()} onReset={() => setName(user.name)} disabled={name.trim().length < 2} />}>
      <div className="mb-5 flex items-center gap-4">
        <span className="bg-brand-gradient flex size-14 items-center justify-center rounded-2xl text-[18px] font-semibold text-white shadow-[var(--brand-glow)]">{initials(name || user.name)}</span>
        <div>
          <p className="text-[15px] font-semibold">{name || user.name}</p>
          <p className="text-[13px] text-foreground-muted">{user.email}</p>
        </div>
      </div>
      <Row label="Full name" htmlFor="profile-name">
        <Input id="profile-name" value={name} maxLength={80} autoComplete="name" onChange={(event) => setName(event.target.value)} />
      </Row>
      <Row label="Email" hint="Your sign-in address. Contact support to change it.">
        <Input value={user.email} disabled readOnly />
      </Row>
    </Section>
  );
}

function strength(password: string) {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(score, 4);
}
const STRENGTH = [
  { label: "Too short", tone: "bg-critical" },
  { label: "Weak", tone: "bg-critical" },
  { label: "Fair", tone: "bg-warning" },
  { label: "Good", tone: "bg-good" },
  { label: "Strong", tone: "bg-good" },
];

function PasswordSection() {
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [signOutOthers, setSignOutOthers] = React.useState(true);
  const score = next ? strength(next) : 0;
  const mismatch = Boolean(confirm) && confirm !== next;
  const valid = current.length > 0 && next.length >= 8 && next === confirm;
  const change = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: signOutOthers });
      if (error) throw new Error(error.message ?? "Could not change your password");
    },
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success(signOutOthers ? "Password changed. Other devices were signed out." : "Password changed");
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <Section
      title="Password"
      description="Use at least 8 characters. A longer passphrase is stronger than a short complex one."
      icon={KeyRound}
      footer={
        <Button variant="primary" size="sm" disabled={!valid || change.isPending} onClick={() => change.mutate()}>
          {change.isPending ? <Spinner className="size-3.5" /> : null} Change password
        </Button>
      }
    >
      <form
        className="grid gap-4 sm:max-w-md"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) change.mutate();
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="password-current">Current password</Label>
          <Input id="password-current" type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password-new">New password</Label>
          <Input id="password-new" type="password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} />
          {next ? (
            <div className="flex items-center gap-2" aria-live="polite">
              <div className="grid flex-1 grid-cols-4 gap-1">
                {[0, 1, 2, 3].map((index) => (
                  <span key={index} className="h-1 overflow-hidden rounded-full bg-surface-sunken">
                    <motion.span className={cn("block h-full", STRENGTH[score]!.tone)} initial={false} animate={{ width: index < score ? "100%" : "0%" }} transition={{ duration: 0.25 }} />
                  </span>
                ))}
              </div>
              <span className="w-16 text-right text-[11.5px] text-foreground-muted">{STRENGTH[next.length < 8 ? 0 : score]!.label}</span>
            </div>
          ) : null}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password-confirm">Confirm new password</Label>
          <Input id="password-confirm" type="password" autoComplete="new-password" value={confirm} aria-invalid={mismatch} onChange={(event) => setConfirm(event.target.value)} />
          {mismatch ? <p className="text-[12px] text-danger-text">The passwords don&apos;t match.</p> : null}
        </div>
        <label className="flex items-center gap-2 text-[13px] text-foreground-secondary">
          <Checkbox checked={signOutOthers} onCheckedChange={(value) => setSignOutOthers(value === true)} /> Sign out of other devices
        </label>
        <button type="submit" hidden />
      </form>
    </Section>
  );
}

interface SessionRow {
  id: string;
  token: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

function describeAgent(agent: string | null | undefined) {
  if (!agent) return { device: "Unknown device", mobile: false };
  const browser = /Edg\//.test(agent) ? "Edge" : /Chrome\//.test(agent) ? "Chrome" : /Firefox\//.test(agent) ? "Firefox" : /Safari\//.test(agent) ? "Safari" : "Browser";
  const os = /Windows/.test(agent) ? "Windows" : /Android/.test(agent) ? "Android" : /iPhone|iPad/.test(agent) ? "iOS" : /Mac OS X/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : "";
  return { device: os ? `${browser} on ${os}` : browser, mobile: /Mobile|Android|iPhone/.test(agent) };
}

function SessionsSection() {
  const queryClient = useQueryClient();
  const current = authClient.useSession();
  const sessions = useQuery({
    queryKey: ["auth-sessions"],
    queryFn: async () => {
      const { data, error } = await authClient.listSessions();
      if (error) throw new Error(error.message ?? "Could not load sessions");
      return (data ?? []) as SessionRow[];
    },
  });
  const revoke = useMutation({
    mutationFn: async (token: string | "others") => {
      const { error } = token === "others" ? await authClient.revokeOtherSessions() : await authClient.revokeSession({ token });
      if (error) throw new Error(error.message ?? "Could not sign that session out");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["auth-sessions"] });
      toast.success("Signed out");
    },
    onError: (error) => toast.error(error.message),
  });
  const currentToken = current.data?.session.token;
  const rows = [...(sessions.data ?? [])].sort((a, b) => (a.token === currentToken ? -1 : b.token === currentToken ? 1 : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
  return (
    <Section
      title="Where you're signed in"
      description="Sign out of devices you don't recognise."
      icon={Laptop}
      footer={
        rows.length > 1 ? (
          <Button variant="secondary" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate("others")}>
            <LogOut /> Sign out everywhere else
          </Button>
        ) : null
      }
    >
      {sessions.isError ? (
        <ErrorState description={sessions.error.message} onRetry={() => void sessions.refetch()} />
      ) : sessions.isLoading ? (
        <Skeleton className="h-24" />
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((session) => {
            const { device, mobile } = describeAgent(session.userAgent);
            const isCurrent = session.token === currentToken;
            return (
              <li key={session.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="flex size-9 items-center justify-center rounded-lg bg-surface-muted">{mobile ? <Smartphone className="size-4 text-foreground-muted" /> : <Laptop className="size-4 text-foreground-muted" />}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[13px] font-medium">
                    {device} {isCurrent ? <Badge tone="success">This device</Badge> : null}
                  </p>
                  <p className="text-[12px] text-foreground-muted">
                    {session.ipAddress ? `${session.ipAddress} · ` : ""}Last active {new Date(session.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                </div>
                {isCurrent ? null : (
                  <Button variant="ghost" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(session.token)}>
                    Sign out
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;
const subscribe = () => () => {};

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const mounted = React.useSyncExternalStore(subscribe, () => true, () => false);
  const current = mounted ? (theme ?? "system") : null;
  return (
    <Section title="Appearance" description="Saved in this browser." icon={Palette}>
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3 sm:max-w-md">
        {THEMES.map((option) => {
          const active = current === option.value;
          return (
            <button key={option.value} type="button" role="radio" aria-checked={active} onClick={() => setTheme(option.value)} className={cn("relative flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-[13px] font-medium transition-colors", active ? "border-transparent" : "border-border hover:bg-surface-muted/60")}>
              {active ? <motion.span layoutId="profile-theme" className="border-gradient absolute inset-0 rounded-xl bg-accent-soft/30" transition={{ type: "spring", stiffness: 500, damping: 36 }} /> : null}
              <option.icon className={cn("relative size-5", active ? "text-brand-1" : "text-foreground-muted")} />
              <span className="relative">{option.label}</span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

export function ProfileSettings() {
  return (
    <>
      <ProfileSection />
      <PasswordSection />
      <SessionsSection />
      <AppearanceSection />
    </>
  );
}
