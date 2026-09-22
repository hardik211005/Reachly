import type { MetadataRoute } from "next";
import { brand } from "@repo/config";

export default function robots(): MetadataRoute.Robots {
  const base = brand.websiteUrl.replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/app", "/api", "/onboarding", "/q/", "/u/", "/invite/"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
