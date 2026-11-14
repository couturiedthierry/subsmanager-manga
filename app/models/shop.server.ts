import prisma from "../db.server";

export async function ensureShop(domain: string, displayName?: string) {
  return prisma.shop.upsert({
    where: { domain },
    create: { domain, displayName },
    update: displayName ? { displayName } : {},
  });
}

export async function getShopSettings(domain: string) {
  return ensureShop(domain);
}

export async function updateShopSettings(
  domain: string,
  settings: {
    supportEmail?: string | null;
    dunningRetries: number;
    retryIntervalDays: number;
    cancelAfterFailures: boolean;
    onboardingComplete?: boolean;
    emailsEnabled?: boolean;
    emailWelcome?: boolean;
    emailRenewalReminder?: boolean;
    reminderDaysBefore?: number;
    emailPaymentFailed?: boolean;
    emailStatusChange?: boolean;
    showProductWidget?: boolean;
    portalEnabled?: boolean;
    portalAllowPause?: boolean;
    portalAllowSkip?: boolean;
    portalAllowCancel?: boolean;
    portalAllowPayment?: boolean;
  },
) {
  const shop = await ensureShop(domain);
  return prisma.shop.update({ where: { id: shop.id }, data: settings });
}

export async function shopAnalytics(domain: string) {
  const shop = await ensureShop(domain);
  const [attempts, activeContracts, failedContracts] = await Promise.all([
    prisma.billingAttempt.findMany({
      where: { shopId: shop.id },
      orderBy: { attemptedAt: "desc" },
      take: 100,
    }),
    prisma.subscriptionContract.count({
      where: { shopId: shop.id, status: "ACTIVE" },
    }),
    prisma.subscriptionContract.count({
      where: { shopId: shop.id, status: "FAILED" },
    }),
  ]);

  const recovered = attempts.filter((attempt) => attempt.status === "SUCCESS").length;
  const failed = attempts.filter((attempt) => attempt.status === "FAILURE").length;
  const revenue = attempts
    .filter((attempt) => attempt.status === "SUCCESS" && attempt.amount)
    .reduce((total, attempt) => total + Number(attempt.amount), 0);

  return {
    activeContracts,
    failedContracts,
    recovered,
    failed,
    revenue,
    currencyCode: shop.currencyCode,
    // Prisma Decimal values cannot be sent to the browser as-is.
    attempts: attempts.map((attempt) => ({
      id: attempt.id,
      shopifyId: attempt.shopifyId,
      status: attempt.status,
      errorCode: attempt.errorCode,
      amount: attempt.amount ? String(attempt.amount) : null,
      currencyCode: attempt.currencyCode,
      attemptedAt: attempt.attemptedAt.toISOString(),
    })),
  };
}
