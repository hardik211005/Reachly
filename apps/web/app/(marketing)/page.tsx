import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { brand, PLAN_DEFINITIONS } from "@repo/config";
import { getEnv } from "@repo/config/env";
import { Hero } from "@/components/marketing/hero";
import { Facts, FeaturesBento, HowItWorks, IntegrationsMarquee, Pricing, Trust, UseCasesStrip } from "@/components/marketing/sections";
import { GENERAL_FAQS } from "@/components/marketing/site";
import { CtaBand, FaqSection } from "@/components/marketing/ui";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: { absolute: `${brand.name} — ${brand.tagline}` },
  description: brand.description,
};

/** Signed-in users go straight to their workspace; everyone else gets the product tour. */
export default async function HomePage() {
  if (await getSession()) redirect("/app");
  const plans = [...PLAN_DEFINITIONS].sort((a, b) => a.sortOrder - b.sortOrder);
  const env = getEnv();
  return (
    <>
      <Hero />
      <IntegrationsMarquee />
      <FeaturesBento />
      <HowItWorks />
      <Facts />
      <UseCasesStrip />
      <Trust />
      <Pricing plans={plans} upi={Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET)} />
      <FaqSection items={GENERAL_FAQS} description={`Anything else? Write to ${brand.supportEmail} or use the contact page.`} />
      <CtaBand />
    </>
  );
}
