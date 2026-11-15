/**
 * Manual approval of Seal renewals.
 *
 * Seal charges every renewal automatically on its billing date and has no setting to turn that
 * off. To keep renewals manual, SubsManager Manga "holds" each upcoming renewal by skipping it in
 * Seal (a skipped renewal is never charged) and records the hold here. When the billing date
 * arrives the renewal shows as due; staff approve it with "Charge due renewal", which asks Seal
 * to charge the subscription now. Renewals the customer skipped themselves are left alone.
 */
import prisma from "../db.server";
import { decryptSecret } from "../lib/control-crypto.server";
import { SealApiError, SealClient } from "../lib/seal.server";
import { isSealAttemptOpen, type SealSubscription } from "../lib/seal-helpers";

export type HeldState = "HELD" | "CHARGING" | "CHARGED" | "SKIPPED" | "RELEASED";

const MAX_PAGES_PER_RUN = 40;
const runningShops = new Set<string>();
const lastRunAt = new Map<string, number>();

export async function sealManualRenewalsEnabled(shopDomain: string) {
  const shop = await prisma.shop.findUnique({ where: { domain: shopDomain }, select: { sealManualRenewals: true } });
  return shop?.sealManualRenewals ?? true;
}

/** Holds the open renewals of one subscription. Returns how many were newly held. */
export async function holdSubscription(shopDomain: string, client: SealClient, subscription: SealSubscription) {
  if (String(subscription.status).toUpperCase() !== "ACTIVE") return { held: 0, errors: 0 };
  const open = (subscription.billing_attempts || []).filter(isSealAttemptOpen);
  if (open.length === 0) return { held: 0, errors: 0 };
  const known = new Set(
    (
      await prisma.sealHeldAttempt.findMany({
        where: { shopDomain, attemptId: { in: open.map((attempt) => String(attempt.id)) } },
        select: { attemptId: true },
      })
    ).map((row) => row.attemptId),
  );
  let held = 0;
  let errors = 0;
  for (const attempt of open) {
    const attemptId = String(attempt.id);
    // A renewal we already handled (held, charged, skipped by staff, or released) is never held again.
    if (known.has(attemptId)) continue;
    try {
      await client.updateBillingAttempt(subscription.id, attempt.id, "skip");
    } catch {
      // Not recorded: if Seal refused (for example because the customer already skipped it),
      // the renewal must not later show as due.
      errors += 1;
      continue;
    }
    await prisma.sealHeldAttempt.upsert({
      where: { shopDomain_attemptId: { shopDomain, attemptId } },
      create: {
        shopDomain,
        subscriptionId: String(subscription.id),
        attemptId,
        billingDate: new Date(attempt.date),
        state: "HELD",
      },
      update: {},
    });
    held += 1;
  }
  return { held, errors };
}

/** Holds every open renewal of every active Seal subscription in the store. */
export async function holdUpcomingSealRenewals(shopDomain: string, client: SealClient) {
  if (runningShops.has(shopDomain)) return { held: 0, errors: 0, subscriptions: 0, skipped: true };
  runningShops.add(shopDomain);
  try {
    let cursor: string | null = null;
    let held = 0;
    let errors = 0;
    let subscriptions = 0;
    for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
      const result = await client.listSubscriptions({ status: "ACTIVE", cursor });
      for (const subscription of result.subscriptions) {
        subscriptions += 1;
        const outcome = await holdSubscription(shopDomain, client, subscription);
        held += outcome.held;
        errors += outcome.errors;
      }
      cursor = result.next_cursor;
      if (!cursor) break;
    }
    lastRunAt.set(shopDomain, Date.now());
    return { held, errors, subscriptions, skipped: false };
  } finally {
    runningShops.delete(shopDomain);
  }
}

/** Starts a hold run in the background when the last one is older than five minutes. */
export function holdSoon(shopDomain: string, client: SealClient) {
  const last = lastRunAt.get(shopDomain) || 0;
  if (Date.now() - last < 5 * 60 * 1000) return;
  lastRunAt.set(shopDomain, Date.now());
  void holdUpcomingSealRenewals(shopDomain, client).catch(() => undefined);
}

/** Gives future held renewals back to Seal so it charges them automatically again. */
export async function releaseSealHolds(shopDomain: string, client: SealClient) {
  const holds = await prisma.sealHeldAttempt.findMany({
    where: { shopDomain, state: "HELD", billingDate: { gt: new Date() } },
  });
  let released = 0;
  let errors = 0;
  for (const hold of holds) {
    try {
      await client.updateBillingAttempt(Number(hold.subscriptionId), Number(hold.attemptId), "unskip");
      await prisma.sealHeldAttempt.update({ where: { id: hold.id }, data: { state: "RELEASED", lastError: null } });
      released += 1;
    } catch (error) {
      errors += 1;
      await prisma.sealHeldAttempt.update({
        where: { id: hold.id },
        data: { lastError: error instanceof Error ? error.message.slice(0, 300) : "Release failed" },
      });
    }
  }
  return { released, errors };
}

export async function heldAttemptsFor(shopDomain: string, subscriptionId: number | string) {
  return prisma.sealHeldAttempt.findMany({
    where: { shopDomain, subscriptionId: String(subscriptionId) },
    orderBy: { billingDate: "asc" },
  });
}

/** Subscription IDs with a held renewal whose billing date has passed. */
export async function dueSealSubscriptionIds(shopDomain: string) {
  const rows = await prisma.sealHeldAttempt.findMany({
    where: { shopDomain, state: "HELD", billingDate: { lte: new Date() } },
    select: { subscriptionId: true },
    distinct: ["subscriptionId"],
  });
  return rows.map((row) => row.subscriptionId);
}

/**
 * Charges a held renewal now. The hold is moved to CHARGING first, so a double click or two staff
 * members cannot charge the same renewal twice.
 */
export async function chargeHeldRenewal(shopDomain: string, client: SealClient, subscriptionId: number, attemptId: string) {
  const claimed = await prisma.sealHeldAttempt.updateMany({
    where: { shopDomain, subscriptionId: String(subscriptionId), attemptId, state: "HELD", billingDate: { lte: new Date() } },
    data: { state: "CHARGING", lastError: null },
  });
  if (claimed.count === 0) throw new Error("This renewal is not due or was already handled. Reload the page.");
  try {
    await client.chargeNow(subscriptionId);
  } catch (error) {
    const message = error instanceof SealApiError ? error.message : "Seal could not charge this renewal";
    await prisma.sealHeldAttempt.updateMany({
      where: { shopDomain, attemptId, state: "CHARGING" },
      data: { state: "HELD", lastError: message.slice(0, 300) },
    });
    throw new Error(message);
  }
  await prisma.sealHeldAttempt.updateMany({
    where: { shopDomain, attemptId, state: "CHARGING" },
    data: { state: "CHARGED", chargedAt: new Date() },
  });
}

/** Staff decided not to charge a held renewal: it stays skipped in Seal and is no longer due. */
export async function skipHeldRenewal(shopDomain: string, subscriptionId: number, attemptId: string) {
  const updated = await prisma.sealHeldAttempt.updateMany({
    where: { shopDomain, subscriptionId: String(subscriptionId), attemptId, state: "HELD" },
    data: { state: "SKIPPED" },
  });
  if (updated.count === 0) throw new Error("This renewal was already handled. Reload the page.");
}

/** Runs the hold for every store that connected Seal with manual renewals on (scheduled job). */
export async function holdAllStores() {
  const shops = await prisma.shop.findMany({
    where: { sealToken: { not: null }, sealManualRenewals: true },
    select: { domain: true, sealToken: true },
  });
  const summary: Array<{ shop: string; held: number; errors: number; subscriptions: number; error?: string }> = [];
  for (const shop of shops) {
    try {
      const client = new SealClient(decryptSecret(shop.sealToken!));
      const result = await holdUpcomingSealRenewals(shop.domain, client);
      summary.push({ shop: shop.domain, held: result.held, errors: result.errors, subscriptions: result.subscriptions });
    } catch (error) {
      summary.push({
        shop: shop.domain,
        held: 0,
        errors: 0,
        subscriptions: 0,
        error: error instanceof Error ? error.message : "Seal hold failed",
      });
    }
  }
  return summary;
}

