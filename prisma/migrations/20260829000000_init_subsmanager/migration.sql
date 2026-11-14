-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "domain" TEXT NOT NULL,
    "displayName" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
    "dunningRetries" INTEGER NOT NULL DEFAULT 3,
    "retryIntervalDays" INTEGER NOT NULL DEFAULT 3,
    "cancelAfterFailures" BOOLEAN NOT NULL DEFAULT false,
    "supportEmail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SubscriptionContract" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "revisionId" TEXT,
    "customerId" TEXT,
    "customerName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "nextBillingAt" DATETIME,
    "lastPaymentStatus" TEXT,
    "linesJson" TEXT NOT NULL DEFAULT '[]',
    "rawJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SubscriptionContract_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BillingAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "contractId" TEXT,
    "shopifyId" TEXT,
    "idempotencyKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorCode" TEXT,
    "amount" DECIMAL,
    "currencyCode" TEXT,
    "orderId" TEXT,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "attemptedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BillingAttempt_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BillingAttempt_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "SubscriptionContract" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SellingPlanCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "merchantCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "rawJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT,
    "shopDomain" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payloadJson" TEXT,
    "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_domain_key" ON "Shop"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionContract_shopifyId_key" ON "SubscriptionContract"("shopifyId");

-- CreateIndex
CREATE INDEX "SubscriptionContract_shopId_status_idx" ON "SubscriptionContract"("shopId", "status");

-- CreateIndex
CREATE INDEX "SubscriptionContract_shopId_nextBillingAt_idx" ON "SubscriptionContract"("shopId", "nextBillingAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAttempt_shopifyId_key" ON "BillingAttempt"("shopifyId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAttempt_idempotencyKey_key" ON "BillingAttempt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BillingAttempt_shopId_attemptedAt_idx" ON "BillingAttempt"("shopId", "attemptedAt");

-- CreateIndex
CREATE INDEX "BillingAttempt_contractId_status_idx" ON "BillingAttempt"("contractId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SellingPlanCache_shopifyId_key" ON "SellingPlanCache"("shopifyId");

-- CreateIndex
CREATE INDEX "SellingPlanCache_shopDomain_status_idx" ON "SellingPlanCache"("shopDomain", "status");

-- CreateIndex
CREATE INDEX "WebhookEvent_shopDomain_topic_idx" ON "WebhookEvent"("shopDomain", "topic");

-- CreateIndex
CREATE INDEX "WebhookEvent_processedAt_idx" ON "WebhookEvent"("processedAt");
