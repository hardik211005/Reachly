import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicPage } from "@repo/core/grow/service";
import { PublicBusinessPage } from "@/components/grow/public-business-page";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const page = await getPublicPage((await params).slug);
  if (!page) return { title: "Page not found" };
  const rating = page.rating.count
    ? ` · ${page.rating.average}★ from ${page.rating.count} reviews`
    : "";
  return {
    title: page.name,
    description:
      `${page.headline ?? page.about ?? page.name}${page.city ? ` — ${page.city}` : ""}${rating}`.slice(
        0,
        300,
      ),
  };
}

/** A business's public page: what they offer, prices, reviews from real customers and an enquiry form. */
export default async function BusinessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await getPublicPage(slug);
  if (!page) notFound();
  return <PublicBusinessPage slug={slug} page={JSON.parse(JSON.stringify(page))} />;
}
