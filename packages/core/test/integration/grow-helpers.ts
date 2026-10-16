import { prisma } from "@repo/db";

export async function createOffering(organizationId: string, name: string, unitPrice: number) {
  return prisma.offering.create({ data: { organizationId, type: "PRODUCT", name, unitPrice, currency: "INR", unit: "piece" } });
}
