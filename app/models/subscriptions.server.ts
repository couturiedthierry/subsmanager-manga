import prisma from "../db.server";
import type { AdminGraphqlClient } from "../lib/graphql.server";
import { graphqlRequest, throwOnUserErrors } from "../lib/graphql.server";
import {
  ACTIVATE_CONTRACT,
  BILLING_ATTEMPT_QUERY,
  CANCEL_CONTRACT,
  CONTRACT_SYNC_QUERY,
  CREATE_BILLING_ATTEMPT,
  EDIT_BILLING_CYCLE_SCHEDULE,
  PAUSE_CONTRACT,
  SEND_PAYMENT_UPDATE_EMAIL,
  SUBSCRIPTION_DETAIL_QUERY,
} from "../lib/shopify-queries";
import { ensureShop } from "./shop.server";
import { sendPaymentFailedEmail, sendStatusChangeEmail } from "../lib/subscription-email.server";
import type { ContractDetail } from "../lib/subscription-helpers";

export { contractTotal, paymentMethodLabel } from "../lib/subscription-helpers";
export type { ContractDetail } from "../lib/subscription-helpers";

const DAY = 24 * 60 * 60 * 1000;

type Money = { amount: string; currencyCode: string };
type UserErrors = Array<{ field?: string[] | null; message: string }>;

export type BillingCycle = {
  cycleIndex: number;
  billingAttemptExpectedDate: string;
  skipped: boolean;
  status: "BILLED" | "UNBILLED";
};

type DetailResponse = {
  shop: { name: string; contactEmail: string | null };
  subscriptionContract: ContractDetail | null;
  subscriptionBillingCycles: { nodes: BillingCycle[] };
};

type SyncContract = {
  id: string;
  status: string;
  currencyCode: string;
  nextBillingDate: string | null;
  lastPaymentStatus: string | null;
  revisionId: string | null;
  customer: { id: string; displayName: string } | null;
  lines: {
    nodes: Array<{ title: string; quantity: number; lineDiscountedPrice: Money }>;
  };
};

export const SUBSCRIPTION_INTENTS = [
  "pause",
  "activate",
  "cancel",
  "skip",
  "unskip",
  "payment-email",
  "charge",
] as const;
export type SubscriptionIntent = (typeof SUBSCRIPTION_INTENTS)[number];

/** Accepts a numeric ID, a URL-encoded GID, or a GID and returns the canonical GID. */
export function contractGid(value: string | null | undefined) {
  const raw = decodeURIComponent(String(value || "")).trim();
  if (raw.startsWith("gid://shopify/SubscriptionContract/")) return raw;
  const numeric = raw.replace(/\D/g, "");
  if (!numeric) throw new Response("Subscription not found", { status: 404 });
  return `gid://shopify/SubscriptionContract/${numeric}`;
}

/** A cycle is due when its date has passed and Shopify has not billed or skipped it. */
export function findDueCycle(cycles: BillingCycle[], now = Date.now()) {
  return cycles.find(
    (cycle) =>
      cycle.status === "UNBILLED" &&
      !cycle.skipped &&
      new Date(cycle.billingAttemptExpectedDate).getTime() <= now,
  ) || null;
}

export function upcomingCycles(cycles: BillingCycle[], now = Date.now(), limit = 6) {
  return cycles
    .filter((cycle) => new Date(cycle.billingAttemptExpectedDate).getTime() > now)
    .slice(0, limit);
}

export async function loadContractDetail(admin: AdminGraphqlClient, id: string) {
  const now = Date.now();
  const data = await graphqlRequest<DetailResponse>(admin, SUBSCRIPTION_DETAIL_QUERY, {
    id,
    // Look back far enough to find an unbilled cycle that is overdue, and forward for upcoming cycles.
    startDate: new Date(now - 120 * DAY).toISOString(),
    endDate: new Date(now + 400 * DAY).toISOString(),
  });
  const cycles = data.subscriptionBillingCycles.nodes;
  return {
    shop: data.shop,
    contract: data.subscriptionContract,
    cycles,
    dueCycle: findDueCycle(cycles, now),
    upcoming: upcomingCycles(cycles, now),
    now,
  };
}

function normalizeStatus(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

/** Writes the contract data that the control center and analytics rely on. */
export async function saveContractSnapshot(shopDomain: string, contract: SyncContract | ContractDetail) {
  const shop = await ensureShop(shopDomain);
  const lines = contract.lines.nodes.map((line) => ({
    title: line.title,
    quantity: line.quantity,
    lineDiscountedPrice: line.lineDiscountedPrice,
  }));
  const data = {
    shopId: shop.id,
    customerId: contract.customer?.id ?? null,
    customerName: contract.customer?.displayName ?? null,
    status: normalizeStatus(contract.status) || "ACTIVE",
    currencyCode: contract.currencyCode,
    nextBillingAt: contract.nextBillingDate ? new Date(contract.nextBillingDate) : null,
    lastPaymentStatus: contract.lastPaymentStatus,
    linesJson: JSON.stringify(lines),
    ...("revisionId" in contract && contract.revisionId ? { revisionId: String(contract.revisionId) } : {}),
  };
  return prisma.subscriptionContract.upsert({
    where: { shopifyId: contract.id },
    create: { shopifyId: contract.id, ...data },
    update: data,
  });
}

/** Fetches one contract from Shopify and stores it locally. Returns null if Shopify no longer has it. */
export async function refreshContract(shopDomain: string, admin: AdminGraphqlClient, id: string) {
  const data = await graphqlRequest<{ subscriptionContract: SyncContract | null }>(
    admin,
    CONTRACT_SYNC_QUERY,
    { id },
  );
  if (!data.subscriptionContract) return null;
  return saveContractSnapshot(shopDomain, data.subscriptionContract);
}

type AttemptLookup = {
  subscriptionBillingAttempt: {
    id: string;
    ready: boolean;
    errorCode: string | null;
    errorMessage: string | null;
    completedAt: string | null;
    subscriptionContract: { id: string } | null;
    order: {
      id: string;
      name: string;
      totalPriceSet: { shopMoney: Money };
    } | null;
  } | null;
};

/**
 * Reads a billing attempt's real outcome from Shopify and stores it.
 * Used by the billing webhooks and as a fallback when a webhook is delayed.
 */
export async function recordBillingAttemptResult(
  shopDomain: string,
  admin: AdminGraphqlClient,
  attemptId: string,
  hint?: { contractId?: string; errorCode?: string | null; succeeded?: boolean },
) {
  const shop = await ensureShop(shopDomain);
  const lookup = await graphqlRequest<AttemptLookup>(admin, BILLING_ATTEMPT_QUERY, { id: attemptId });
  const attempt = lookup.subscriptionBillingAttempt;
  const contractShopifyId = attempt?.subscriptionContract?.id || hint?.contractId;
  const contract = contractShopifyId
    ? await prisma.subscriptionContract.findUnique({ where: { shopifyId: contractShopifyId } })
    : null;

  // Still processing at Shopify: nothing final to record yet.
  if (attempt && !attempt.ready && hint?.succeeded === undefined) return null;

  const succeeded = attempt
    ? !attempt.errorCode && (Boolean(attempt.order) || hint?.succeeded === true)
    : Boolean(hint?.succeeded);
  const status = succeeded ? "SUCCESS" : "FAILURE";
  const money = attempt?.order?.totalPriceSet.shopMoney;
  const errorCode = attempt?.errorCode || hint?.errorCode || null;
  const data = {
    shopId: shop.id,
    contractId: contract?.id ?? null,
    status,
    ready: true,
    errorCode: succeeded ? null : (errorCode || attempt?.errorMessage || "PAYMENT_FAILED").slice(0, 200),
    amount: money ? money.amount : undefined,
    currencyCode: money ? money.currencyCode : undefined,
    orderId: attempt?.order?.id ?? undefined,
  };
  const previous = await prisma.billingAttempt.findUnique({
    where: { shopifyId: attemptId },
    select: { status: true },
  });
  const saved = await prisma.billingAttempt.upsert({
    where: { shopifyId: attemptId },
    create: { shopifyId: attemptId, ...data },
    update: data,
  });

  if (status === "FAILURE" && previous?.status !== "FAILURE" && contractShopifyId) {
    void sendPaymentFailedEmail(shopDomain, contractShopifyId, attemptId).catch((error) => {
      console.error(`Payment failed email could not be sent for ${shopDomain}`, error);
    });
  }

  if (contractShopifyId) {
    // Shopify moves nextBillingDate after a successful charge; keep the mirror accurate.
    await refreshContract(shopDomain, admin, contractShopifyId).catch(() => undefined);
  }
  return saved;
}

/** Resolves local attempts that are still waiting for a Shopify result (e.g. a missed webhook). */
export async function refreshPendingAttempts(shopDomain: string, admin: AdminGraphqlClient, contractShopifyId: string) {
  const contract = await prisma.subscriptionContract.findUnique({ where: { shopifyId: contractShopifyId } });
  if (!contract) return;
  const pending = await prisma.billingAttempt.findMany({
    where: { contractId: contract.id, status: { in: ["PENDING", "PROCESSING"] }, shopifyId: { not: null } },
    take: 5,
  });
  for (const attempt of pending) {
    await recordBillingAttemptResult(shopDomain, admin, attempt.shopifyId as string).catch(() => undefined);
  }
}

export async function localBillingHistory(contractShopifyId: string) {
  const contract = await prisma.subscriptionContract.findUnique({ where: { shopifyId: contractShopifyId } });
  if (!contract) return [];
  const attempts = await prisma.billingAttempt.findMany({
    where: { contractId: contract.id },
    orderBy: { attemptedAt: "desc" },
    take: 20,
  });
  return attempts.map((attempt) => ({
    id: attempt.id,
    shopifyId: attempt.shopifyId,
    status: attempt.status,
    errorCode: attempt.errorCode,
    amount: attempt.amount ? String(attempt.amount) : null,
    currencyCode: attempt.currencyCode,
    attemptedAt: attempt.attemptedAt.toISOString(),
  }));
}

async function chargeDueCycle(shopDomain: string, admin: AdminGraphqlClient, id: string) {
  const detail = await loadContractDetail(admin, id);
  const contract = detail.contract;
  if (!contract) throw new Error("Shopify no longer returns this subscription");
  if (contract.status !== "ACTIVE") throw new Error("Only an active subscription can be charged");
  if (!contract.customerPaymentMethod || contract.customerPaymentMethod.revokedAt) {
    throw new Error("This subscription has no usable payment method. Send a payment update email first.");
  }
  const due = detail.dueCycle;
  if (!due) throw new Error("No billing cycle is due yet. Future cycles cannot be charged early.");

  const local = await saveContractSnapshot(shopDomain, contract);
  await refreshPendingAttempts(shopDomain, admin, contract.id);

  const prefix = `manual:${contract.id}:cycle-${due.cycleIndex}:`;
  // A request that crashed before Shopify answered leaves a placeholder with no Shopify ID.
  await prisma.billingAttempt.updateMany({
    where: {
      contractId: local.id,
      idempotencyKey: { startsWith: prefix },
      status: "PROCESSING",
      shopifyId: null,
      attemptedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) },
    },
    data: { status: "FAILURE", errorCode: "REQUEST_INTERRUPTED", ready: true },
  });
  const previous = await prisma.billingAttempt.findMany({
    where: { contractId: local.id, idempotencyKey: { startsWith: prefix } },
  });
  const open = previous.find((attempt) => ["PENDING", "PROCESSING"].includes(attempt.status));
  if (open) throw new Error("A charge for this cycle is already processing. Wait for Shopify's result.");
  if (previous.some((attempt) => attempt.status === "SUCCESS")) {
    throw new Error("This cycle has already been charged successfully");
  }

  // A failed attempt can be retried after the customer fixes their payment method.
  // Each retry gets its own idempotency key so Shopify treats it as a new attempt.
  const idempotencyKey = `${prefix}${previous.length + 1}`;
  const placeholder = await prisma.billingAttempt.create({
    data: { shopId: local.shopId, contractId: local.id, idempotencyKey, status: "PROCESSING" },
  });

  try {
    const result = await graphqlRequest<{
      subscriptionBillingAttemptCreate: {
        subscriptionBillingAttempt: { id: string; ready: boolean; errorCode: string | null; errorMessage: string | null } | null;
        userErrors: UserErrors;
      };
    }>(admin, CREATE_BILLING_ATTEMPT, {
      subscriptionContractId: contract.id,
      input: {
        idempotencyKey,
        billingCycleSelector: { index: due.cycleIndex },
      },
    });
    throwOnUserErrors(result.subscriptionBillingAttemptCreate.userErrors);
    const attempt = result.subscriptionBillingAttemptCreate.subscriptionBillingAttempt;
    if (!attempt) throw new Error("Shopify did not create a billing attempt");
    await prisma.billingAttempt.update({
      where: { id: placeholder.id },
      data: { shopifyId: attempt.id, status: "PENDING", ready: attempt.ready },
    });
    if (attempt.ready) {
      await recordBillingAttemptResult(shopDomain, admin, attempt.id).catch(() => undefined);
    }
    return `Charge requested for the cycle due ${new Date(due.billingAttemptExpectedDate).toLocaleDateString("en-US")}`;
  } catch (error) {
    await prisma.billingAttempt.update({
      where: { id: placeholder.id },
      data: {
        status: "FAILURE",
        errorCode: (error instanceof Error ? error.message : "REQUEST_FAILED").slice(0, 200),
        ready: true,
      },
    }).catch(() => undefined);
    throw error;
  }
}

/**
 * Runs one subscription action against Shopify. Shared by the embedded app and the
 * control center so both behave exactly the same way.
 */
export async function runSubscriptionAction(input: {
  admin: AdminGraphqlClient;
  shopDomain: string;
  contractId: string;
  intent: string;
  cycleIndex?: number;
}): Promise<{ summary: string }> {
  const { admin, shopDomain, contractId, intent } = input;
  const variables = { subscriptionContractId: contractId };
  const before = await prisma.subscriptionContract.findUnique({
    where: { shopifyId: contractId },
    select: { status: true },
  });
  let summary: string;
  let errors: UserErrors | undefined;

  switch (intent) {
    case "pause": {
      const data = await graphqlRequest<{ subscriptionContractPause: { userErrors: UserErrors } }>(admin, PAUSE_CONTRACT, variables);
      errors = data.subscriptionContractPause.userErrors;
      summary = "Subscription paused";
      break;
    }
    case "activate": {
      const data = await graphqlRequest<{ subscriptionContractActivate: { userErrors: UserErrors } }>(admin, ACTIVATE_CONTRACT, variables);
      errors = data.subscriptionContractActivate.userErrors;
      summary = "Subscription resumed";
      break;
    }
    case "cancel": {
      const data = await graphqlRequest<{ subscriptionContractCancel: { userErrors: UserErrors } }>(admin, CANCEL_CONTRACT, variables);
      errors = data.subscriptionContractCancel.userErrors;
      summary = "Subscription cancelled";
      break;
    }
    case "skip":
    case "unskip": {
      const cycleIndex = Number(input.cycleIndex);
      if (!Number.isInteger(cycleIndex) || cycleIndex < 0) throw new Error("A valid billing cycle is required");
      const data = await graphqlRequest<{ subscriptionBillingCycleScheduleEdit: { userErrors: UserErrors } }>(
        admin,
        EDIT_BILLING_CYCLE_SCHEDULE,
        {
          billingCycleInput: { contractId, selector: { index: cycleIndex } },
          input: { reason: "MERCHANT_INITIATED", skip: intent === "skip" },
        },
      );
      errors = data.subscriptionBillingCycleScheduleEdit.userErrors;
      summary = intent === "skip" ? `Skipped billing cycle #${cycleIndex}` : `Restored billing cycle #${cycleIndex}`;
      break;
    }
    case "payment-email": {
      const detail = await loadContractDetail(admin, contractId);
      const method = detail.contract?.customerPaymentMethod;
      if (!method?.id) throw new Error("This subscription has no payment method that can be updated");
      const data = await graphqlRequest<{ customerPaymentMethodSendUpdateEmail: { userErrors: UserErrors } }>(
        admin,
        SEND_PAYMENT_UPDATE_EMAIL,
        { customerPaymentMethodId: method.id, emailInput: null },
      );
      errors = data.customerPaymentMethodSendUpdateEmail.userErrors;
      summary = "Payment update email sent to the customer";
      break;
    }
    case "charge":
      summary = await chargeDueCycle(shopDomain, admin, contractId);
      break;
    default:
      throw new Error("Unknown subscription action");
  }

  throwOnUserErrors(errors);
  if (intent !== "charge") {
    const after = await refreshContract(shopDomain, admin, contractId).catch(() => null);
    const expected = { pause: "PAUSED", activate: "ACTIVE", cancel: "CANCELLED" }[intent as "pause" | "activate" | "cancel"];
    if (expected && after?.status === expected && before?.status !== expected) {
      // Keyed by contract revision, so the matching Shopify webhook can't send a second copy.
      void sendStatusChangeEmail(shopDomain, contractId, expected, after.revisionId || `app-${Date.now()}`)
        .catch((error) => console.error(`Status email failed for ${shopDomain}`, error));
    }
  }
  return { summary };
}
