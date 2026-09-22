import type { Metadata } from "next";
import { ComplianceSettings } from "@/components/settings/compliance-settings";

export const metadata: Metadata = { title: "Compliance" };

export default function CompliancePage() {
  return <ComplianceSettings />;
}
