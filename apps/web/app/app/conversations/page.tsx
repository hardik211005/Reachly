import { Suspense } from "react";
import type { Metadata } from "next";
import { inboxSummary } from "@repo/core/outreach/inbox";
import { Skeleton } from "@repo/ui";
import { InboxView } from "@/components/inbox/inbox-view";
import { requireWorkspace } from "@/lib/session";

export const metadata: Metadata = { title: "Inbox" };

export default async function ConversationsPage() {
  const { ctx } = await requireWorkspace();
  const summary = await inboxSummary(ctx);
  return (
    <Suspense fallback={<Skeleton className="m-6 h-[70vh]" />}>
      <InboxView counts={{ needsResponse: summary.needsResponse, pendingApproval: summary.pendingApproval }} />
    </Suspense>
  );
}
