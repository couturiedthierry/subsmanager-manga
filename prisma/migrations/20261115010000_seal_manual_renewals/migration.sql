-- Manual approval of Seal renewals
ALTER TABLE "Shop" ADD COLUMN "sealManualRenewals" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "SealHeldAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "billingDate" DATETIME NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'HELD',
    "chargedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "SealHeldAttempt_shopDomain_attemptId_key" ON "SealHeldAttempt"("shopDomain", "attemptId");
CREATE INDEX "SealHeldAttempt_shopDomain_state_billingDate_idx" ON "SealHeldAttempt"("shopDomain", "state", "billingDate");
CREATE INDEX "SealHeldAttempt_shopDomain_subscriptionId_idx" ON "SealHeldAttempt"("shopDomain", "subscriptionId");
