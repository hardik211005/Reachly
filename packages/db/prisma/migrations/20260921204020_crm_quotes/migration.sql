-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EventType" ADD VALUE 'quote_viewed';
ALTER TYPE "EventType" ADD VALUE 'quote_expired';

-- AlterTable
ALTER TABLE "deals" ADD COLUMN     "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "quote_line_items" ADD COLUMN     "details" TEXT,
ADD COLUMN     "priceSource" TEXT NOT NULL DEFAULT 'catalog';

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "contactId" UUID,
ADD COLUMN     "respondedByName" TEXT,
ADD COLUMN     "responseNote" TEXT,
ADD COLUMN     "title" TEXT,
ADD COLUMN     "viewedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "quote_settings" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "numberPrefix" TEXT NOT NULL DEFAULT 'Q',
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "validityDays" INTEGER NOT NULL DEFAULT 15,
    "legalName" TEXT,
    "address" TEXT,
    "taxId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "terms" TEXT,
    "footer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quote_settings_organizationId_key" ON "quote_settings"("organizationId");

-- AddForeignKey
ALTER TABLE "quote_settings" ADD CONSTRAINT "quote_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
