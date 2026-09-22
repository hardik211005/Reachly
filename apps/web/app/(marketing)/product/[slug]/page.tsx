import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductPageView } from "@/components/marketing/product-views";
import { PRODUCTS, productBySlug } from "@/components/marketing/site";

export function generateStaticParams() {
  return PRODUCTS.map((product) => ({ slug: product.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const product = productBySlug((await params).slug);
  if (!product) return {};
  return { title: product.name, description: product.intro };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!productBySlug(slug)) notFound();
  return <ProductPageView slug={slug} />;
}
