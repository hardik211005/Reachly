import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { brand, PLAN_DEFINITIONS } from "@repo/config";
import { Hero } from "@/components/marketing/hero";
import { MarketingNav } from "@/components/marketing/nav";
import { Facts, Faq, FeaturesBento, FinalCta, Footer, HowItWorks, IntegrationsMarquee, Pricing, Trust } from "@/components/marketing/sections";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: { absolute: `${brand.name} — ${brand.tagline}` },
  description: brand.description,
};

/** Signed-in users go straight to their workspace; everyone else gets the product tour. */
export default async function HomePage() {
  if (await getSession()) redirect("/app");
  const plans = [...PLAN_DEFINITIONS].sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <div className="min-h-dvh overflow-x-clip bg-background">
      <MarketingNav />
      <main>
        <Hero />
        <IntegrationsMarquee />
        <FeaturesBento />
        <HowItWorks />
        <Facts />
        <Trust />
        <Pricing plans={plans} />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
