import type { Metadata } from "next";
import { ProductOverviewView } from "@/components/marketing/product-views";

export const metadata: Metadata = {
  title: "Platform overview",
  description: "Lead discovery, AI outreach, AI calling, workflows, CRM & quotes and analytics — one connected workspace for B2B sales.",
};

export default function ProductOverviewPage() {
  return <ProductOverviewView />;
}
