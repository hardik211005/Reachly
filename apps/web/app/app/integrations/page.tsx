import type { Metadata } from "next";
import { IntegrationsView } from "@/components/integrations/integrations-view";
import { PageContainer } from "@/components/page";

export const metadata: Metadata = { title: "Integrations" };

export default function IntegrationsPage() {
  return (
    <PageContainer wide>
      <IntegrationsView />
    </PageContainer>
  );
}
