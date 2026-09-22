import type { Metadata } from "next";
import { brand } from "@repo/config";
import { AboutView } from "@/components/marketing/company-views";

export const metadata: Metadata = {
  title: "About",
  description: `Why we're building ${brand.name}, and the principles behind it.`,
};

export default function AboutPage() {
  return <AboutView />;
}
