-- CreateTable
CREATE TABLE "StaffUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'SUPPORT',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mfaSecret" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StaffSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "mfaVerified" BOOLEAN NOT NULL DEFAULT false,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "StaffUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "StaffUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffUser_email_key" ON "StaffUser"("email");

-- CreateIndex
CREATE INDEX "StaffUser_active_role_idx" ON "StaffUser"("active", "role");

-- CreateIndex
CREATE INDEX "StaffSession_userId_expiresAt_idx" ON "StaffSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "StaffSession_expiresAt_idx" ON "StaffSession"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_createdAt_idx" ON "AuditEvent"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_shopId_createdAt_idx" ON "AuditEvent"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");

CREATE TABLE "CustomerNotification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerId" TEXT,
    "lastError" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerNotification_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CustomerNotification_key_key" ON "CustomerNotification"("key");
CREATE INDEX "CustomerNotification_shopId_status_idx" ON "CustomerNotification"("shopId", "status");
