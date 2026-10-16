import type { Metadata } from "next";
import { GrowView } from "@/components/grow/grow-view";
import { PageHero } from "@/components/page-hero";
import { PageContainer } from "@/components/page";

export const metadata: Metadata = { title: "Your page & reviews" };

export default function GrowPage() {
  return (
    <PageContainer className="grid gap-6">
      <PageHero
        title="Grow your business"
        highlight="Grow"
        description="Get found with a public page, build trust with reviews from real customers, and keep customers coming back after every win."
      />
      <GrowView />
    </PageContainer>
  );
}
