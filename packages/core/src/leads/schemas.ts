import { LEAD_STATUSES } from "@repo/config";
import { z } from "zod";

const csvArray = <T extends z.ZodType>(item: T) =>
  z.preprocess((value) => {
    if (value === undefined || value === "") return undefined;
    if (Array.isArray(value)) return value.flatMap((entry) => String(entry).split(",")).filter(Boolean);
    return String(value).split(",").filter(Boolean);
  }, z.array(item).optional());

const booleanParam = z.preprocess((value) => (value === "true" ? true : value === "false" ? false : value), z.boolean().optional());

export const LEAD_SORT_FIELDS = ["score", "name", "createdAt", "lastActivityAt", "city", "status"] as const;

export const leadListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(120).optional(),
  status: csvArray(z.enum(LEAD_STATUSES)),
  fitTier: csvArray(z.enum(["HIGH", "MEDIUM", "LOW"])),
  qualification: csvArray(z.enum(["QUALIFIED", "NEEDS_REVIEW", "UNQUALIFIED"])),
  city: csvArray(z.string().max(120)),
  category: csvArray(z.string().max(80)),
  source: csvArray(z.string().max(60)),
  campaignId: z.uuid().optional(),
  ownerId: z.uuid().optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  maxScore: z.coerce.number().int().min(0).max(100).optional(),
  hasEmail: booleanParam,
  hasPhone: booleanParam,
  includeDnc: booleanParam,
  discoveryRunId: z.uuid().optional(),
  ids: csvArray(z.uuid()),
  sort: z.enum(LEAD_SORT_FIELDS).default("score"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type LeadListQuery = z.infer<typeof leadListQuerySchema>;
export type LeadListQueryInput = z.input<typeof leadListQuerySchema>;

export const leadCreateSchema = z.object({
  name: z.string().trim().min(2).max(200),
  category: z.string().trim().max(80).nullable().optional(),
  industry: z.string().trim().max(120).nullable().optional(),
  website: z.string().trim().max(300).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.email().nullable().optional().or(z.literal("").transform(() => null)),
  address: z.string().trim().max(300).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  region: z.string().trim().max(120).nullable().optional(),
  country: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  contact: z
    .object({
      name: z.string().trim().max(120).nullable().optional(),
      title: z.string().trim().max(120).nullable().optional(),
      email: z.email().nullable().optional(),
      phone: z.string().trim().max(40).nullable().optional(),
    })
    .optional(),
});
export type LeadCreateInput = z.input<typeof leadCreateSchema>;

export const leadUpdateSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  category: z.string().trim().max(80).nullable().optional(),
  industry: z.string().trim().max(120).nullable().optional(),
  website: z.string().trim().max(300).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.email().nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  ownerId: z.uuid().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  nextAction: z.string().trim().max(200).nullable().optional(),
  nextActionAt: z.coerce.date().nullable().optional(),
});
export type LeadUpdateInput = z.input<typeof leadUpdateSchema>;

export const bulkLeadActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), ids: z.array(z.uuid()).min(1).max(500), status: z.enum(LEAD_STATUSES) }),
  z.object({ action: z.literal("add_to_campaign"), ids: z.array(z.uuid()).min(1).max(500), campaignId: z.uuid() }),
  z.object({ action: z.literal("delete"), ids: z.array(z.uuid()).min(1).max(500) }),
  z.object({ action: z.literal("do_not_contact"), ids: z.array(z.uuid()).min(1).max(500) }),
  z.object({ action: z.literal("rescore"), ids: z.array(z.uuid()).min(1).max(200) }),
  z.object({ action: z.literal("assign"), ids: z.array(z.uuid()).min(1).max(500), ownerId: z.uuid().nullable() }),
  z.object({ action: z.literal("tag"), ids: z.array(z.uuid()).min(1).max(500), tag: z.string().trim().min(1).max(40) }),
]);
export type BulkLeadAction = z.infer<typeof bulkLeadActionSchema>;

export const contactInputSchema = z.object({
  name: z.string().trim().max(120).nullable().optional(),
  title: z.string().trim().max(120).nullable().optional(),
  email: z.email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  whatsapp: z.string().trim().max(40).nullable().optional(),
  linkedinUrl: z.url().nullable().optional(),
  isPrimary: z.boolean().optional(),
  whatsappOptIn: z.boolean().optional(),
});
export type ContactInput = z.input<typeof contactInputSchema>;

export const importMappingSchema = z.object({
  name: z.string(),
  website: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  city: z.string().optional(),
  category: z.string().optional(),
  address: z.string().optional(),
  contactName: z.string().optional(),
  contactTitle: z.string().optional(),
  notes: z.string().optional(),
});

export const importRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  csv: z.string().min(1).max(2_000_000),
  mapping: importMappingSchema,
  campaignId: z.uuid().optional(),
});
export type ImportRequest = z.input<typeof importRequestSchema>;
