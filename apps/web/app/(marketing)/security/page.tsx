import type { Metadata } from "next";
import { SecurityView } from "@/components/marketing/company-views";

export const metadata: Metadata = {
  title: "Security",
  description: "Workspace isolation, encrypted credentials, hashed API keys, roles, audit logs and signed webhooks.",
};

export default function SecurityPage() {
  return <SecurityView />;
}
