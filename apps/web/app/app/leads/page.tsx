import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Telescope } from "lucide-react";
import { Button, PageHeader, Skeleton } from "@repo/ui";
import { ImportLeadsDialog, NewLeadDialog } from "@/components/leads/lead-dialogs";
import { LeadsTable } from "@/components/leads/leads-table";
import { PageContainer } from "@/components/page";
import { PageGuide } from "@/components/page-guide";
import { requireWorkspace } from "@/lib/session";

export const metadata: Metadata = { title: "Customer list" };

export default async function LeadsPage() {
  const { ctx } = await requireWorkspace();
  const total = await ctx.db.lead.count({ where: { deletedAt: null } });

  return (
    <PageContainer wide>
      <PageHeader
        title="Customer list"
        description={`${total.toLocaleString()} businesses you could sell to. The best fits are at the top — open any one to see why.`}
        actions={
          <>
            <Button asChild size="sm" variant="ghost">
              <a href="/api/v1/leads/export" download>
                Export
              </a>
            </Button>
            <ImportLeadsDialog />
            <Button asChild size="sm">
              <Link href="/app/discover">
                <Telescope /> Find more
              </Link>
            </Button>
            <NewLeadDialog />
          </>
        }
        className="mb-5"
      />
      <div className="mb-5">
        <PageGuide
          id="customer-list"
          title="How your customer list works"
          steps={[
            {
              title: "We find businesses",
              body: "Every search adds matching businesses here, with their phone, email and website when available.",
            },
            {
              title: "Best fits come first",
              body: "The score (out of 100) shows how likely they are to buy. Open any business to see why.",
            },
            {
              title: "Reach out",
              body: "Add the best ones to an offer, or call them. Chains are hidden if you chose to skip them.",
            },
          ]}
        />
      </div>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <LeadsTable />
      </Suspense>
    </PageContainer>
  );
}
