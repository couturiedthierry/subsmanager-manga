-- Optional connection to the Seal Subscriptions API (token stored encrypted)
ALTER TABLE "Shop" ADD COLUMN "sealToken" TEXT;
ALTER TABLE "Shop" ADD COLUMN "sealConnectedAt" DATETIME;
