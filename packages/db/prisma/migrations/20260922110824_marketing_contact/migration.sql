-- CreateEnum
CREATE TYPE "ContactTopic" AS ENUM ('SALES', 'SUPPORT', 'PARTNERSHIP', 'PRESS', 'OTHER');

-- CreateEnum
CREATE TYPE "ContactRequestStatus" AS ENUM ('NEW', 'HANDLED', 'SPAM');

-- CreateTable
CREATE TABLE "contact_requests" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT,
    "topic" "ContactTopic" NOT NULL,
    "message" TEXT NOT NULL,
    "source" TEXT,
    "ipHash" TEXT,
    "status" "ContactRequestStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_requests_status_createdAt_idx" ON "contact_requests"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "contact_requests_email_idx" ON "contact_requests"("email");
