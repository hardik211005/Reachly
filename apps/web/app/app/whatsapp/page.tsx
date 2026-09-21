import type { Metadata } from "next";
import { PageHeader } from "@repo/ui";
import { WhatsAppView } from "@/components/channels/whatsapp-view";
import { PageContainer } from "@/components/page";
import { requireWorkspace } from "@/lib/session";

export const metadata: Metadata = { title: "WhatsApp" };

export default async function WhatsAppPage() {
  const { ctx } = await requireWorkspace();
  const compliance = await ctx.db.complianceSettings.findFirst({ select: { whatsappRequireOptIn: true } });
  return (
    <PageContainer wide>
      <PageHeader
        title="WhatsApp"
        description="Official WhatsApp Business API messaging: templates, delivery and replies, within Meta’s policies."
        className="mb-5"
      />
      <WhatsAppView requireOptIn={compliance?.whatsappRequireOptIn ?? true} />
    </PageContainer>
  );
}
