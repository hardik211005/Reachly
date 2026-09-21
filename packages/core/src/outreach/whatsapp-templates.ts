import { z } from "zod";
import { assertCan, type TenantContext } from "../context";
import { ConflictError, NotFoundError, PreconditionError } from "../errors";
import { audit } from "../audit";
import { resolveWhatsAppProvider } from "./providers";

/**
 * WhatsApp message templates. Business-initiated WhatsApp messages must use a template
 * approved by Meta. Real templates are created in WhatsApp Manager and synced here;
 * in demo mode, templates can be added locally and are marked approved for simulation only.
 */

export const templateInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_]+$/, "Lowercase letters, numbers and underscores only (Meta naming rules)"),
  language: z.string().trim().min(2).max(10).default("en"),
  category: z.enum(["MARKETING", "UTILITY"]).default("MARKETING"),
  body: z.string().trim().min(1).max(1024),
  variables: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
});

export async function listWhatsAppTemplates(ctx: TenantContext) {
  assertCan(ctx, "campaigns:read");
  const [templates, provider] = await Promise.all([
    ctx.db.whatsAppTemplate.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }], include: { _count: { select: { steps: true } } } }),
    resolveWhatsAppProvider(ctx).then((resolved) => ({ ok: true as const, name: resolved.name, simulated: resolved.isMock })).catch(() => ({ ok: false as const, name: null, simulated: false })),
  ]);
  return { templates, provider };
}

function placeholderCount(body: string): number {
  const indexes = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
  return indexes.length ? Math.max(...indexes) : 0;
}

export async function createWhatsAppTemplate(ctx: TenantContext, input: z.input<typeof templateInputSchema>) {
  assertCan(ctx, "campaigns:write");
  const data = templateInputSchema.parse(input);
  const provider = await resolveWhatsAppProvider(ctx);
  if (!provider.isMock) {
    throw new PreconditionError("Create templates in WhatsApp Manager so Meta can review them, then use “Sync templates” to import them.");
  }
  const needed = placeholderCount(data.body);
  if (data.variables.length !== needed) throw new PreconditionError(`The body uses ${needed} placeholder${needed === 1 ? "" : "s"} ({{1}}…); label each one`);
  const existing = await ctx.db.whatsAppTemplate.findFirst({ where: { name: data.name, language: data.language } });
  if (existing) throw new ConflictError("A template with this name and language already exists");
  const template = await ctx.db.whatsAppTemplate.create({
    data: { organizationId: ctx.organizationId, ...data, status: "APPROVED", provider: "mock", syncedAt: new Date() },
  });
  await audit(ctx, { action: "whatsapp_template.created", resourceType: "whatsapp_template", resourceId: template.id, metadata: { name: data.name, simulated: true } });
  return template;
}

/** Imports templates (and their review status) from the connected WhatsApp Business Account. */
export async function syncWhatsAppTemplates(ctx: TenantContext) {
  assertCan(ctx, "campaigns:write");
  const provider = await resolveWhatsAppProvider(ctx);
  if (!provider.listTemplates) throw new PreconditionError("This WhatsApp provider doesn't support template sync");
  const remote = await provider.listTemplates();
  const now = new Date();
  for (const template of remote) {
    const variables = template.variables ?? Array.from({ length: placeholderCount(template.body) }, (_, index) => `param_${index + 1}`);
    await ctx.db.whatsAppTemplate.upsert({
      where: { organizationId_name_language: { organizationId: ctx.organizationId, name: template.name, language: template.language } },
      create: {
        organizationId: ctx.organizationId,
        name: template.name,
        language: template.language,
        category: template.category,
        body: template.body,
        variables,
        status: template.status,
        provider: provider.name,
        providerTemplateId: template.providerTemplateId,
        syncedAt: now,
      },
      update: { category: template.category, body: template.body, status: template.status, providerTemplateId: template.providerTemplateId, syncedAt: now, ...(template.variables ? { variables } : {}) },
    });
  }
  return { synced: remote.length, provider: provider.name, simulated: provider.isMock };
}

export async function updateTemplateVariables(ctx: TenantContext, id: string, variables: string[]) {
  assertCan(ctx, "campaigns:write");
  const template = await ctx.db.whatsAppTemplate.findFirst({ where: { id } });
  if (!template) throw new NotFoundError("WhatsApp template", id);
  const needed = placeholderCount(template.body);
  if (variables.length !== needed) throw new PreconditionError(`Map all ${needed} placeholders`);
  return ctx.db.whatsAppTemplate.update({ where: { id }, data: { variables } });
}

export async function deleteWhatsAppTemplate(ctx: TenantContext, id: string) {
  assertCan(ctx, "campaigns:write");
  const template = await ctx.db.whatsAppTemplate.findFirst({ where: { id }, include: { _count: { select: { steps: true } } } });
  if (!template) throw new NotFoundError("WhatsApp template", id);
  if (template._count.steps > 0) throw new PreconditionError("This template is used by campaign steps");
  await ctx.db.whatsAppTemplate.delete({ where: { id } });
}

/** Variables templates can map to — the same ones outreach messages use. */
export const TEMPLATE_VARIABLES = ["first_name", "business_name", "sender_name", "sender_company", "offer_short", "locality", "call_to_action"] as const;
