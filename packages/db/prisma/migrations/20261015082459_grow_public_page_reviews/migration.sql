-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('REQUESTED', 'PUBLISHED', 'HIDDEN');

-- AlterEnum
ALTER TYPE "LeadSourceType" ADD VALUE 'INBOUND';

-- CreateTable
CREATE TABLE "public_pages" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "headline" TEXT,
    "about" TEXT,
    "showPrices" BOOLEAN NOT NULL DEFAULT true,
    "acceptEnquiries" BOOLEAN NOT NULL DEFAULT true,
    "afterWinFollowUps" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "leadId" UUID,
    "dealId" UUID,
    "token" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'REQUESTED',
    "rating" INTEGER,
    "comment" TEXT,
    "authorName" TEXT,
    "authorRole" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "public_pages_organizationId_key" ON "public_pages"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_token_key" ON "reviews"("token");

-- CreateIndex
CREATE INDEX "reviews_organizationId_status_submittedAt_idx" ON "reviews"("organizationId", "status", "submittedAt" DESC);

-- AddForeignKey
ALTER TABLE "public_pages" ADD CONSTRAINT "public_pages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
