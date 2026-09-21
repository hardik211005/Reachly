import type { Metadata } from "next";
import Link from "next/link";
import { Megaphone } from "lucide-react";
import { quietHoursSchema } from "@repo/core/outreach/policy";
import { resolveEmailProvider } from "@repo/core/outreach/providers";
import { Button, PageHeader } from "@repo/ui";
import { EmailView } from "@/components/channels/email-view";
import { PageContainer } from "@/components/page";
import { requireWorkspace } from "@/lib/session";

export const metadata: Metadata = { title: "Email" };

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function describeWindow(window: { start: number; end: number; days: number[] }): string {
  const days = [...window.days].sort((a, b) => a - b);
  const contiguous = days.every((day, index) => index === 0 || day === (days[index - 1] ?? 0) + 1);
  const dayText = days.length === 7 ? "every day" : contiguous && days.length > 1 ? `${DAY_NAMES[days[0] ?? 1]}–${DAY_NAMES[days.at(-1) ?? 5]}` : days.map((day) => DAY_NAMES[day]).join(", ");
  return `${dayText}, ${String(window.start).padStart(2, "0")}:00–${String(window.end).padStart(2, "0")}:00`;
}

export default async function EmailPage() {
  const { ctx } = await requireWorkspace();
  const [compliance, provider] = await Promise.all([ctx.db.complianceSettings.findFirst(), resolveEmailProvider(ctx).catch(() => null)]);
  const window = quietHoursSchema.parse(compliance?.quietHours ?? {});
  return (
    <PageContainer wide>
      <PageHeader
        title="Email"
        description="Deliverability and engagement for every email sent from this workspace, from recorded provider events."
        actions={
          <Button asChild size="sm" variant="secondary">
            <Link href="/app/campaigns/new">
              <Megaphone /> New campaign
            </Link>
          </Button>
        }
        className="mb-5"
      />
      <EmailView
        settings={{
          from: provider?.from ?? null,
          replyTo: provider?.replyTo ?? null,
          postalAddress: Boolean(compliance?.postalAddress),
          footer: Boolean(compliance?.emailFooter),
          unsubscribeLink: compliance?.includeUnsubscribeLink ?? true,
          firstTouchApproval: compliance?.requireApprovalFirstTouch ?? true,
          sendWindow: describeWindow(window),
        }}
      />
    </PageContainer>
  );
}
