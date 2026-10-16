"use client";

import * as React from "react";

export interface ShellData {
  user: { id: string; name: string; email: string; image: string | null };
  workspace: {
    id: string;
    name: string;
    slug: string;
    currency: string;
    timezone: string;
    logoUrl: string | null;
  };
  workspaces: Array<{ id: string; name: string; slug: string }>;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  plan: { key: string; name: string };
  demoMode: boolean;
  /** Provider categories currently served by mock adapters. */
  mockProviders: string[];
  /** Listed in PLATFORM_ADMIN_EMAILS: sees /admin across every workspace. */
  platformAdmin: boolean;
  /** Free trial of the paid plan, while it lasts. */
  trial: { planName: string; daysLeft: number } | null;
  /** Leads that can still be found this month (allowance + bought top-ups); null = unlimited. */
  leadsLeft: number | null;
  /** This month's allowance plus bought top-ups, for the fill ring; null = unlimited. */
  leadsTotal: number | null;
}

const ShellContext = React.createContext<ShellData | null>(null);

export function ShellProvider({
  value,
  children,
}: {
  value: ShellData;
  children: React.ReactNode;
}) {
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellData {
  const value = React.useContext(ShellContext);
  if (!value) throw new Error("useShell must be used inside the app shell");
  return value;
}

export function useCanManage(): boolean {
  const { role } = useShell();
  return role === "OWNER" || role === "ADMIN";
}

export function useCanWrite(): boolean {
  const { role } = useShell();
  return role !== "VIEWER";
}
