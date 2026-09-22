import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEnv } from "@repo/config/env";
import { LoginForm } from "@/components/auth/auth-forms";
import { authConfig } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { DEMO_CREDENTIALS } from "@/lib/demo";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getSession()) {
    const { next } = await searchParams;
    redirect(next?.startsWith("/invite/") ? next : "/app");
  }
  return (
    <Suspense>
      <LoginForm googleEnabled={authConfig.googleConfigured} demoCredentials={getEnv().DEMO_MODE ? DEMO_CREDENTIALS : undefined} />
    </Suspense>
  );
}
