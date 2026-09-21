import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { callReadiness } from "@repo/core/calls/policy";
import { getCall } from "@repo/core/calls/service";
import { NotFoundError } from "@repo/core/errors";
import { CallDetail, type CallDetailData } from "@/components/calls/call-detail";
import { PageContainer } from "@/components/page";
import { requireWorkspace } from "@/lib/session";

export const metadata: Metadata = { title: "Call" };

async function load(ctx: Awaited<ReturnType<typeof requireWorkspace>>["ctx"], id: string) {
  try {
    return await Promise.all([getCall(ctx, id), callReadiness(ctx)]);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireWorkspace();
  const { id } = await params;
  const [call, readiness] = await load(ctx, id);
  return (
    <PageContainer wide>
      <CallDetail
        initial={JSON.parse(JSON.stringify(call)) as CallDetailData}
        simulatedProvider={readiness.provider.simulated}
        announceAi={readiness.settings.announceAiOnCalls}
        aiReady={readiness.ready}
      />
    </PageContainer>
  );
}
