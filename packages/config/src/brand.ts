/**
 * Centralised product branding. Nothing else in the codebase should hard-code the
 * product name — import `brand` instead so a rename is a one-file change.
 * Values can be overridden per deployment with NEXT_PUBLIC_BRAND_* variables.
 */
export const brand = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME ?? "ReachAI",
  shortName: process.env.NEXT_PUBLIC_BRAND_SHORT_NAME ?? "ReachAI",
  tagline: "Find, qualify and reach the right B2B buyers.",
  description:
    "Lead discovery, AI qualification and multi-channel outreach for businesses that sell to other businesses.",
  supportEmail: process.env.NEXT_PUBLIC_BRAND_SUPPORT_EMAIL ?? "support@reachai.dev",
  legalName: process.env.NEXT_PUBLIC_BRAND_LEGAL_NAME ?? "ReachAI Technologies",
  websiteUrl: process.env.NEXT_PUBLIC_BRAND_WEBSITE ?? "https://reachai.dev",
  /** Prefix for API keys, e.g. `rk_live_…`. */
  apiKeyPrefix: "rk",
} as const;

export type Brand = typeof brand;
