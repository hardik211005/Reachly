import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth/auth-forms";
import { authConfig } from "@/lib/auth";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getSession()) {
    const { next } = await searchParams;
    redirect(next?.startsWith("/invite/") ? next : "/onboarding");
  }
  return (
    <Suspense>
      <SignupForm googleEnabled={authConfig.googleConfigured} requireVerification={authConfig.requireEmailVerification} />
    </Suspense>
  );
}
