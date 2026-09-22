import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// The monorepo keeps one .env at the root; load it before Next reads process.env.
loadEnvConfig(resolve(process.cwd(), "../.."));

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Razorpay Checkout (UPI) runs in an iframe that may use the Payment Request API and open bank popups.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self \"https://api.razorpay.com\" \"https://checkout.razorpay.com\")" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  // Keep the dev badge away from the sidebar profile menu.
  devIndicators: { position: "bottom-right" },
  // A second dev server (the e2e one) needs its own build folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  transpilePackages: ["@repo/ui", "@repo/core", "@repo/config", "@repo/db", "@repo/ai", "@repo/integrations", "@repo/queue"],
  serverExternalPackages: ["pino", "bullmq", "ioredis", "pg", "@prisma/adapter-pg", "nodemailer", "pdf-lib", "@pdf-lib/fontkit", "stripe"],
  // Quote PDFs embed these fonts; standalone builds must ship them.
  outputFileTracingIncludes: { "/**": ["../../packages/core/assets/fonts/*"] },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
