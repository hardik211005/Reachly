"use client";

import * as React from "react";

export interface ShellData {
  user: { id: string; name: string; email: string; image: string | null };
  workspace: { id: string; name: string; slug: string; currency: string; timezone: string };
  workspaces: Array<{ id: string; name: string; slug: string }>;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  plan: { key: string; name: string };
  demoMode: boolean;
  /** Provider categories currently served by mock adapters. */
  mockProviders: string[];
}

const ShellContext = React.createContext<ShellData | null>(null);

export function ShellProvider({ value, children }: { value: ShellData; children: React.ReactNode }) {
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
