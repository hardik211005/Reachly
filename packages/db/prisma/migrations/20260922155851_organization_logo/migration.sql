-- CreateTable
CREATE TABLE "organization_logos" (
    "organizationId" UUID NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_logos_pkey" PRIMARY KEY ("organizationId")
);

-- AddForeignKey
ALTER TABLE "organization_logos" ADD CONSTRAINT "organization_logos_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
