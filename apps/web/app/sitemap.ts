import type { MetadataRoute } from "next";
import { brand } from "@repo/config";
import { PRODUCTS, USE_CASES } from "@/components/marketing/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = brand.websiteUrl.replace(/\/$/, "");
  const paths = ["/", "/product", "/pricing", "/use-cases", "/about", "/security", "/contact", "/privacy", "/terms", ...PRODUCTS.map((product) => `/product/${product.slug}`), ...USE_CASES.map((item) => `/use-cases/${item.slug}`)];
  return paths.map((path) => ({ url: `${base}${path}`, changeFrequency: "monthly", priority: path === "/" ? 1 : path.startsWith("/product") || path === "/pricing" ? 0.8 : 0.5 }));
}
