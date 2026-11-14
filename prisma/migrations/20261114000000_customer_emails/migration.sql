-- Customer email settings per store
ALTER TABLE "Shop" ADD COLUMN "emailsEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Shop" ADD COLUMN "emailWelcome" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Shop" ADD COLUMN "emailRenewalReminder" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Shop" ADD COLUMN "reminderDaysBefore" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "Shop" ADD COLUMN "emailPaymentFailed" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Shop" ADD COLUMN "emailStatusChange" BOOLEAN NOT NULL DEFAULT true;

-- Which contract and address each customer email was for
ALTER TABLE "CustomerNotification" ADD COLUMN "contractId" TEXT;
ALTER TABLE "CustomerNotification" ADD COLUMN "recipient" TEXT;
