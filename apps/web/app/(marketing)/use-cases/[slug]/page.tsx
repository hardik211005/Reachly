import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { USE_CASES, findUseCase } from "@/components/marketing/site";
import { UseCasePageView } from "@/components/marketing/use-case-views";

export function generateStaticParams() {
  return USE_CASES.map((item) => ({ slug: item.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const useCase = findUseCase((await params).slug);
  if (!useCase) return {};
  return { title: `For ${useCase.name.toLowerCase()}`, description: useCase.intro };
}

export default async function UseCasePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!findUseCase(slug)) notFound();
  return <UseCasePageView slug={slug} />;
}
