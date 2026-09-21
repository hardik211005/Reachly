import { BUSINESS_SIZES, CHANNELS } from "@repo/config";
import { z } from "zod";

/** Business profile as entered during onboarding / settings. */
export const businessProfileInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  website: z
    .string()
    .trim()
    .max(300)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional(),
  industry: z.string().trim().min(2).max(120),
  description: z.string().trim().min(20, "Describe what you sell in at least a sentence").max(2000),
  city: z.string().trim().max(120).nullable().optional(),
  region: z.string().trim().max(120).nullable().optional(),
  country: z.string().trim().max(120).nullable().optional(),
  businessSize: z.enum(BUSINESS_SIZES),
  pricingModel: z.string().trim().max(200).nullable().optional(),
  targetIndustries: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  targetCustomerTypes: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  valueProposition: z.string().trim().max(1000).nullable().optional(),
  outreachTone: z.string().trim().max(60).default("professional"),
  preferredChannels: z.array(z.enum(CHANNELS)).default(["EMAIL"]),
});
export type BusinessProfileInput = z.input<typeof businessProfileInputSchema>;
export type BusinessProfileData = z.output<typeof businessProfileInputSchema>;

export const offeringInputSchema = z.object({
  type: z.enum(["PRODUCT", "SERVICE", "PACKAGE"]),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).nullable().optional(),
  unit: z.string().trim().max(40).default("unit"),
  unitPrice: z.number().nonnegative().nullable().optional(),
  currency: z.string().length(3).default("INR"),
  minOrderQuantity: z.number().int().positive().nullable().optional(),
  setupFee: z.number().nonnegative().nullable().optional(),
  taxRatePercent: z.number().min(0).max(100).nullable().optional(),
  sku: z.string().trim().max(60).nullable().optional(),
  isActive: z.boolean().default(true),
});
export type OfferingInput = z.input<typeof offeringInputSchema>;

/**
 * AI-generated, user-editable Ideal Customer Profile. Stored on BusinessProfile.icp.
 * All fields are required (nullable where optional) so the schema works with strict
 * structured-output modes.
 */
export const icpSchema = z.object({
  summary: z.string().describe("Two or three sentences on what the business sells and to whom."),
  idealCustomerProfile: z.object({
    description: z.string(),
    companySizes: z.array(z.string()),
    mustHaves: z.array(z.string()),
    niceToHaves: z.array(z.string()),
    disqualifiers: z.array(z.string()),
  }),
  targetIndustries: z.array(z.string()),
  targetCategories: z.array(z.string()).describe("Concrete business categories to search for, e.g. 'cafe'."),
  buyerPersonas: z.array(
    z.object({
      title: z.string(),
      goals: z.array(z.string()),
      painPoints: z.array(z.string()),
    }),
  ),
  recommendedLocations: z.array(z.string()),
  leadKeywords: z.array(z.string()),
  buyingSignals: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      description: z.string(),
    }),
  ),
  outreachAngle: z.string(),
  valueProposition: z.string(),
  suggestedChannels: z.array(z.enum(CHANNELS)),
});
export type Icp = z.infer<typeof icpSchema>;
