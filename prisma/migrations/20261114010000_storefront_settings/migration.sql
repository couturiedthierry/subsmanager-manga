-- Storefront and customer-portal switches per store
ALTER TABLE "Shop" ADD COLUMN "showProductWidget" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Shop" ADD COLUMN "portalEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Shop" ADD COLUMN "portalAllowPause" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Shop" ADD COLUMN "portalAllowSkip" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Shop" ADD COLUMN "portalAllowCancel" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Shop" ADD COLUMN "portalAllowPayment" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Shop" ADD COLUMN "storefrontSyncedAt" DATETIME;
ALTER TABLE "Shop" ADD COLUMN "storefrontSyncError" TEXT;
