import type { Metadata } from "next";
import { IntegrationsView } from "@/components/integrations/integrations-view";

export const metadata: Metadata = { title: "Integrations" };

export default function IntegrationsPage() {
  return <IntegrationsView />;
}
