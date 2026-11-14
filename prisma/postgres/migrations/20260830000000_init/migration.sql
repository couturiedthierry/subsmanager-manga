CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE "StaffRole" AS ENUM ('OWNER', 'ADMIN', 'SUPPORT', 'VIEWER');

CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "displayName" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
    "dunningRetries" INTEGER NOT NULL DEFAULT 3,
    "retryIntervalDays" INTEGER NOT NULL DEFAULT 3,
    "cancelAfterFailures" BOOLEAN NOT NULL DEFAULT false,
    "supportEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubscriptionContract" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "revisionId" TEXT,
    "customerId" TEXT,
    "customerName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "nextBillingAt" TIMESTAMP(3),
    "lastPaymentStatus" TEXT,
    "linesJson" TEXT NOT NULL DEFAULT '[]',
    "rawJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SubscriptionContract_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingAttempt" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "contractId" TEXT,
    "shopifyId" TEXT,
    "idempotencyKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorCode" TEXT,
    "amount" DECIMAL(65,30),
    "currencyCode" TEXT,
    "orderId" TEXT,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillingAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SellingPlanCache" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "merchantCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "rawJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SellingPlanCache_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT,
    "shopDomain" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payloadJson" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StaffUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL DEFAULT 'SUPPORT',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mfaSecret" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StaffUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StaffSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "mfaVerified" BOOLEAN NOT NULL DEFAULT false,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "shopId" TEXT,
    "shopDomain" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "summary" TEXT NOT NULL,
    "metadataJson" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerNotification" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerId" TEXT,
    "lastError" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Shop_domain_key" ON "Shop"("domain");
CREATE UNIQUE INDEX "SubscriptionContract_shopifyId_key" ON "SubscriptionContract"("shopifyId");
CREATE INDEX "SubscriptionContract_shopId_status_idx" ON "SubscriptionContract"("shopId", "status");
CREATE INDEX "SubscriptionContract_shopId_nextBillingAt_idx" ON "SubscriptionContract"("shopId", "nextBillingAt");
CREATE UNIQUE INDEX "BillingAttempt_shopifyId_key" ON "BillingAttempt"("shopifyId");
CREATE UNIQUE INDEX "BillingAttempt_idempotencyKey_key" ON "BillingAttempt"("idempotencyKey");
CREATE INDEX "BillingAttempt_shopId_attemptedAt_idx" ON "BillingAttempt"("shopId", "attemptedAt");
CREATE INDEX "BillingAttempt_contractId_status_idx" ON "BillingAttempt"("contractId", "status");
CREATE UNIQUE INDEX "SellingPlanCache_shopifyId_key" ON "SellingPlanCache"("shopifyId");
CREATE INDEX "SellingPlanCache_shopDomain_status_idx" ON "SellingPlanCache"("shopDomain", "status");
CREATE INDEX "WebhookEvent_shopDomain_topic_idx" ON "WebhookEvent"("shopDomain", "topic");
CREATE INDEX "WebhookEvent_processedAt_idx" ON "WebhookEvent"("processedAt");
CREATE UNIQUE INDEX "StaffUser_email_key" ON "StaffUser"("email");
CREATE INDEX "StaffUser_active_role_idx" ON "StaffUser"("active", "role");
CREATE INDEX "StaffSession_userId_expiresAt_idx" ON "StaffSession"("userId", "expiresAt");
CREATE INDEX "StaffSession_expiresAt_idx" ON "StaffSession"("expiresAt");
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");
CREATE INDEX "AuditEvent_actorId_createdAt_idx" ON "AuditEvent"("actorId", "createdAt");
CREATE INDEX "AuditEvent_shopId_createdAt_idx" ON "AuditEvent"("shopId", "createdAt");
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");
CREATE UNIQUE INDEX "CustomerNotification_key_key" ON "CustomerNotification"("key");
CREATE INDEX "CustomerNotification_shopId_status_idx" ON "CustomerNotification"("shopId", "status");

ALTER TABLE "SubscriptionContract" ADD CONSTRAINT "SubscriptionContract_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingAttempt" ADD CONSTRAINT "BillingAttempt_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingAttempt" ADD CONSTRAINT "BillingAttempt_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "SubscriptionContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffSession" ADD CONSTRAINT "StaffSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "StaffUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerNotification" ADD CONSTRAINT "CustomerNotification_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
