-- AlterTable
ALTER TABLE "campaign_steps" ADD COLUMN     "whatsappTemplateId" UUID;

-- AlterTable
ALTER TABLE "compliance_settings" ADD COLUMN     "blockSimulatedLeadsOnRealProviders" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "whatsappRequireOptIn" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "whatsapp_templates" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "category" TEXT NOT NULL DEFAULT 'MARKETING',
    "body" TEXT NOT NULL,
    "variables" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "providerTemplateId" TEXT,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_templates_organizationId_name_language_key" ON "whatsapp_templates"("organizationId", "name", "language");

-- AddForeignKey
ALTER TABLE "campaign_steps" ADD CONSTRAINT "campaign_steps_whatsappTemplateId_fkey" FOREIGN KEY ("whatsappTemplateId") REFERENCES "whatsapp_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
