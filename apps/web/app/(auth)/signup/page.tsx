import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth/auth-forms";
import { authConfig } from "@/lib/auth";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage() {
  if (await getSession()) redirect("/onboarding");
  return <SignupForm googleEnabled={authConfig.googleConfigured} requireVerification={authConfig.requireEmailVerification} />;
}
