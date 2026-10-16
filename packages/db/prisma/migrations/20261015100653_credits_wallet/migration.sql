-- CreateTable
CREATE TABLE "credit_balances" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "metric" "UsageMetric" NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_purchases" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "packKey" TEXT NOT NULL,
    "metric" "UsageMetric" NOT NULL,
    "amount" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "provider" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "providerPaymentId" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credit_balances_organizationId_metric_key" ON "credit_balances"("organizationId", "metric");

-- CreateIndex
CREATE UNIQUE INDEX "credit_purchases_providerPaymentId_key" ON "credit_purchases"("providerPaymentId");

-- CreateIndex
CREATE INDEX "credit_purchases_organizationId_createdAt_idx" ON "credit_purchases"("organizationId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "credit_balances" ADD CONSTRAINT "credit_balances_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_purchases" ADD CONSTRAINT "credit_purchases_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
