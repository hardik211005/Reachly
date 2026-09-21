import type { Metadata } from "next";
import { callReadiness } from "@repo/core/calls/policy";
import { CallsView, type CallReadiness } from "@/components/calls/calls-view";
import { PageContainer } from "@/components/page";
import { requireWorkspace } from "@/lib/session";

export const metadata: Metadata = { title: "Calls" };

export default async function CallsPage() {
  const { ctx } = await requireWorkspace();
  const readiness = await callReadiness(ctx);
  return (
    <PageContainer wide>
      <CallsView initialReadiness={JSON.parse(JSON.stringify(readiness)) as CallReadiness} />
    </PageContainer>
  );
}
