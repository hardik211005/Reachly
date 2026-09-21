import { beforeAll, describe, expect, it } from "vitest";
import { prisma, TenantViolationError } from "@repo/db";
import { globalSearch } from "../../src/search/service";
import { createLead, createWorkspace, resetDatabase } from "./helpers";

describe("tenant isolation", () => {
  let a: Awaited<ReturnType<typeof createWorkspace>>;
  let b: Awaited<ReturnType<typeof createWorkspace>>;
  let leadB: { id: string };

  beforeAll(async () => {
    await resetDatabase();
    a = await createWorkspace("Workspace A");
    b = await createWorkspace("Workspace B");
    await createLead(a.ctx, { name: "Alpha Cafe" });
    leadB = await createLead(b.ctx, { name: "Bravo Bistro" });
  });

  it("scopes reads to the context's organization", async () => {
    expect(await a.ctx.db.lead.findFirst({ where: { id: leadB.id } })).toBeNull();
    expect(await a.ctx.db.lead.findUnique({ where: { id: leadB.id } })).toBeNull();
    expect(await a.ctx.db.lead.count()).toBe(1);
    expect(await b.ctx.db.lead.count()).toBe(1);
  });

  it("cannot update or delete another tenant's rows", async () => {
    const result = await a.ctx.db.lead.updateMany({ where: { id: leadB.id }, data: { name: "Hijacked" } });
    expect(result.count).toBe(0);
    await expect(a.ctx.db.lead.update({ where: { id: leadB.id }, data: { name: "Hijacked" } })).rejects.toThrow();
    await expect(a.ctx.db.lead.delete({ where: { id: leadB.id } })).rejects.toThrow();
    const untouched = await prisma.lead.findUniqueOrThrow({ where: { id: leadB.id } });
    expect(untouched.name).toBe("Bravo Bistro");
  });

  it("rejects explicit cross-tenant organizationId in where and create", async () => {
    await expect(a.ctx.db.lead.findMany({ where: { organizationId: b.organizationId } })).rejects.toBeInstanceOf(TenantViolationError);
    await expect(
      a.ctx.db.lead.create({
        data: { organizationId: b.organizationId, name: "Sneaky", dedupeKey: "sneaky", sourceType: "MANUAL", sourceProvider: "manual" },
      }),
    ).rejects.toBeInstanceOf(TenantViolationError);
  });

  it("stamps organizationId on creates", async () => {
    const lead = await a.ctx.db.lead.create({
      data: { organizationId: a.organizationId, name: "Stamped", dedupeKey: "stamped", sourceType: "MANUAL", sourceProvider: "manual" },
    });
    expect(lead.organizationId).toBe(a.organizationId);
  });

  it("global search never returns other tenants' data", async () => {
    const results = await globalSearch(a.ctx, "Bistro");
    expect(results).toHaveLength(0);
    const own = await globalSearch(a.ctx, "Alpha");
    expect(own.map((r) => r.title)).toContain("Alpha Cafe");
  });

  it("aggregations are tenant-scoped", async () => {
    const grouped = await a.ctx.db.lead.groupBy({ by: ["organizationId"], _count: { _all: true } });
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.organizationId).toBe(a.organizationId);
  });
});
