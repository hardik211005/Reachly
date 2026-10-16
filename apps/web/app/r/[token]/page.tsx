import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getReviewInvite } from "@repo/core/grow/service";
import { ReviewForm } from "@/components/grow/review-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Leave a review", robots: { index: false } };

/** A customer's private link to review a business they worked with. */
export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await getReviewInvite(token);
  if (!invite) notFound();
  return <ReviewForm token={token} invite={invite} />;
}
