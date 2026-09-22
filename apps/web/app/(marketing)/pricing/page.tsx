import type { Metadata } from "next";
import { PLAN_DEFINITIONS } from "@repo/config";
import { PricingPageView } from "@/components/marketing/pricing-view";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Start free. Compare every plan's limits and features side by side.",
};

export default function PricingPage() {
  const plans = [...PLAN_DEFINITIONS].sort((a, b) => a.sortOrder - b.sortOrder);
  return <PricingPageView plans={plans} />;
}
