import { z } from "zod";
import { addSuppression, listSuppressions } from "@repo/core/compliance/suppression";
import { ValidationError } from "@repo/core/errors";
import { created, ok, route } from "@/lib/api";

const query = z.object({ q: z.string().trim().max(120).optional(), page: z.coerce.number().int().min(1).default(1) });
const body = z.object({ value: z.string().trim().min(3).max(200), note: z.string().trim().max(300).optional() });

export const GET = route<Record<string, never>, undefined, typeof query>({ query, permission: "workspace:read" }, async ({ ctx, query: input }) => ok(await listSuppressions(ctx, { q: input.q, page: input.page, pageSize: 50 })));

/** Blocks an email address, phone number or domain on every channel. */
export const POST = route({ body, permission: "compliance:manage", rateLimit: 30 }, async ({ ctx, body: input }) => {
  const value = input.value;
  const target = value.includes("@") ? { email: value } : /^\+?[\d\s()-]{7,}$/.test(value) ? { phone: value } : /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value) ? { domain: value } : null;
  if (!target) throw new ValidationError("Enter an email address, a phone number with country code, or a domain");
  await addSuppression(ctx, target, { reason: "MANUAL", note: input.note, sourceType: "settings" });
  return created({ added: true });
});
