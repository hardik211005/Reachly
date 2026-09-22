import type { Metadata } from "next";
import { BillingView } from "@/components/billing/billing-view";
import { PageContainer } from "@/components/page";

export const metadata: Metadata = { title: "Billing" };

export default function BillingPage() {
  return (
    <PageContainer wide>
      <BillingView />
    </PageContainer>
  );
}
