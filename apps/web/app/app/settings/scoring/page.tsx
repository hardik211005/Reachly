import type { Metadata } from "next";
import { ScoringSettings } from "@/components/settings/scoring-settings";

export const metadata: Metadata = { title: "Lead scoring" };

export default function ScoringPage() {
  return <ScoringSettings />;
}
