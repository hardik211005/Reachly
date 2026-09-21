import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Telescope } from "lucide-react";
import { Button, PageHeader, Skeleton } from "@repo/ui";
import { ImportLeadsDialog, NewLeadDialog } from "@/components/leads/lead-dialogs";
import { LeadsTable } from "@/components/leads/leads-table";
import { PageContainer } from "@/components/page";
import { requireWorkspace } from "@/lib/session";

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage() {
  const { ctx } = await requireWorkspace();
  const total = await ctx.db.lead.count({ where: { deletedAt: null } });

  return (
    <PageContainer wide>
      <PageHeader
        title="Leads"
        description={`${total.toLocaleString()} businesses in this workspace. Scores update as leads are enriched and engage.`}
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
                <Telescope /> Discover
              </Link>
            </Button>
            <NewLeadDialog />
          </>
        }
        className="mb-5"
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <LeadsTable />
      </Suspense>
    </PageContainer>
  );
}
