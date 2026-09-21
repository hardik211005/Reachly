import type { Prisma } from "@repo/db";
import { getQueue } from "@repo/queue";
import { consumeUsage, isLimitError } from "../billing/usage";
import { addLeadsToCampaign } from "../campaigns/audience";
import { systemContext } from "../context";
import { executeDiscoveryRun } from "../discovery/service";
import { recordEvent } from "../events";
import { enrichLead } from "../leads/enrichment";
import { dedupeKeyFor, normalizeDomain, normalizeEmail, normalizePhone, normalizeWebsite } from "../leads/normalize";
import { importMappingSchema } from "../leads/schemas";
import { scoreLeadById } from "../leads/scoring-service";
import { notify } from "../notifications";
import { parseCsvRecords } from "../shared/csv";
import { registerProcessor } from "./registry";
import { matchCategory } from "@repo/config/taxonomy";

registerProcessor("discovery.run", async ({ organizationId, runId }) => {
  const ctx = systemContext(organizationId);
  return executeDiscoveryRun(ctx, runId);
});

registerProcessor("leads.enrich", async ({ organizationId, leadId, thenScore }) => {
  const ctx = systemContext(organizationId);
  const result = await enrichLead(ctx, leadId).catch((error: unknown) => ({ status: "FAILED" as const, error: String(error) }));
  if (thenScore) await getQueue().enqueue("leads.score", { organizationId, leadId }, { jobId: `score:${leadId}:${Date.now()}` });
  return result;
});

registerProcessor("leads.score", async ({ organizationId, leadId, campaignId }) => {
  const ctx = systemContext(organizationId);
  const result = await scoreLeadById(ctx, leadId, { campaignId: campaignId ?? null });
  return { total: result.total, qualification: result.qualification };
});

const MAX_IMPORT_ROWS = 5000;

registerProcessor("leads.import", async ({ organizationId, importJobId }) => {
  const ctx = systemContext(organizationId);
  const job = await ctx.db.importJob.findFirst({ where: { id: importJobId } });
  if (!job || job.status === "COMPLETED") return { skipped: true };
  const mapping = importMappingSchema.parse(job.mapping);
  const { records } = parseCsvRecords(job.sourceData ?? "");
  const rows = records.slice(0, MAX_IMPORT_ROWS);
  const errors: Array<{ row: number; message: string }> = [];
  if (records.length > MAX_IMPORT_ROWS) errors.push({ row: 0, message: `Only the first ${MAX_IMPORT_ROWS} rows were imported` });

  await ctx.db.importJob.update({ where: { id: job.id }, data: { status: "PROCESSING", totalRows: rows.length } });
  let imported = 0;
  let duplicates = 0;
  let failed = 0;
  const createdIds: string[] = [];
  const get = (record: Record<string, string>, column: string | undefined) => (column ? (record[column] ?? "").trim() : "");

  for (const [index, record] of rows.entries()) {
    const rowNumber = index + 2; // header is row 1
    const name = get(record, mapping.name);
    if (!name) {
      failed += 1;
      errors.push({ row: rowNumber, message: "Missing business name" });
      continue;
    }
    const website = normalizeWebsite(get(record, mapping.website) || null);
    const phone = normalizePhone(get(record, mapping.phone) || null);
    const email = normalizeEmail(get(record, mapping.email) || null);
    const city = get(record, mapping.city) || null;
    const dedupeKey = dedupeKeyFor({ website, phone, name, city });
    const existing = await ctx.db.lead.findFirst({ where: { dedupeKey, deletedAt: null }, select: { id: true } });
    if (existing) {
      duplicates += 1;
      continue;
    }
    try {
      await consumeUsage(ctx, "LEAD_CREDITS", 1, { sourceType: "csv_import", sourceId: job.id, idempotencyKey: `import:${job.id}:${dedupeKey}` });
    } catch (error) {
      if (isLimitError(error)) {
        errors.push({ row: rowNumber, message: "Lead credits exhausted — remaining rows skipped" });
        failed += rows.length - index;
        break;
      }
      throw error;
    }
    const categoryText = get(record, mapping.category);
    const category = categoryText ? (matchCategory(categoryText)?.key ?? categoryText.toLowerCase()) : null;
    const lead = await ctx.db.lead.create({
      data: {
        organizationId,
        name,
        dedupeKey,
        website,
        domain: normalizeDomain(website),
        phone,
        email,
        city,
        address: get(record, mapping.address) || null,
        category,
        industry: category ? (matchCategory(category)?.industry ?? null) : null,
        sourceType: "CSV_IMPORT",
        sourceProvider: "csv",
      },
    });
    await ctx.db.leadSource.create({
      data: { organizationId, leadId: lead.id, sourceType: "CSV_IMPORT", provider: "csv", externalId: `${job.id}:${rowNumber}`, rawData: record as Prisma.InputJsonValue, importJobId: job.id },
    });
    const contactName = get(record, mapping.contactName);
    if (contactName || email || phone) {
      await ctx.db.contact.create({
        data: {
          organizationId,
          leadId: lead.id,
          kind: contactName ? "PERSON" : "GENERIC",
          name: contactName || null,
          title: get(record, mapping.contactTitle) || null,
          email,
          phone,
          source: "csv",
          isPrimary: true,
        },
      });
    }
    const note = get(record, mapping.notes);
    if (note) await ctx.db.note.create({ data: { organizationId, leadId: lead.id, body: note } });
    await recordEvent(ctx, { type: "lead_created", leadId: lead.id, properties: { source: "csv_import", importJobId: job.id }, idempotencyKey: `lead_created:${lead.id}` });
    await recordEvent(ctx, { type: "lead_imported", leadId: lead.id, properties: { importJobId: job.id, row: rowNumber } });
    createdIds.push(lead.id);
    imported += 1;
    if (imported % 25 === 0) await ctx.db.importJob.update({ where: { id: job.id }, data: { importedRows: imported, duplicateRows: duplicates, failedRows: failed } });
  }

  if (job.campaignId && createdIds.length) await addLeadsToCampaign(ctx, job.campaignId, createdIds);
  for (const leadId of createdIds) {
    await getQueue().enqueue("leads.enrich", { organizationId, leadId, thenScore: true });
  }

  await ctx.db.importJob.update({
    where: { id: job.id },
    data: {
      status: "COMPLETED",
      importedRows: imported,
      duplicateRows: duplicates,
      failedRows: failed,
      errors: errors.slice(0, 200) as Prisma.InputJsonValue,
      sourceData: null,
      completedAt: new Date(),
    },
  });
  await notify(ctx, {
    type: "import.completed",
    userId: job.createdById,
    title: `Import finished: ${imported} leads added`,
    body: `${duplicates} duplicates skipped${failed ? `, ${failed} rows failed` : ""}. Leads are being enriched and scored.`,
    link: "/app/leads?source=csv",
  });
  return { imported, duplicates, failed };
});

