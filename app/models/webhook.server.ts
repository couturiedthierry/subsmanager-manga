import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { ensureShop } from "./shop.server";
import { recordBillingAttemptResult, refreshContract } from "./subscriptions.server";
import { sendPaymentFailedEmail } from "../lib/subscription-email.server";

type JsonRecord = Record<string, unknown>;

function value(payload: JsonRecord, ...keys: string[]) {
  for (const key of keys) {
    if (payload[key] !== undefined && payload[key] !== null && payload[key] !== "") return payload[key];
  }
  return undefined;
}

function gid(type: string, raw: unknown) {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const text = String(raw);
  return text.startsWith("gid://") ? text : `gid://shopify/${type}/${text}`;
}

/** True if this webhook delivery was already processed successfully. */
export async function isDuplicateWebhook(webhookId: string) {
  if (!webhookId) return false;
  return Boolean(await prisma.webhookEvent.findUnique({ where: { id: webhookId } }));
}

/**
 * Records a webhook only after it was processed, so a failed attempt is retried by Shopify
 * instead of being silently skipped as a duplicate.
 */
export async function rememberWebhook(
  webhookId: string,
  shopDomain: string,
  topic: string,
  payload: JsonRecord,
) {
  if (!webhookId) return;
  const shop = await ensureShop(shopDomain);
  await prisma.webhookEvent.upsert({
    where: { id: webhookId },
    create: {
      id: webhookId,
      shopId: shop.id,
      shopDomain,
      topic,
      payloadJson: JSON.stringify(payload).slice(0, 20_000),
    },
    update: {},
  });
}

export async function syncContractWebhook(shopDomain: string, payload: JsonRecord) {
  const shopifyId = gid("SubscriptionContract", value(payload, "admin_graphql_api_id", "id"));
  if (!shopifyId) return null;

  // Webhook payloads omit the customer name, line items, and next billing date,
  // so read the full contract from Shopify.
  try {
    const { admin } = await unauthenticated.admin(shopDomain);
    const saved = await refreshContract(shopDomain, admin, shopifyId);
    if (saved) return saved;
  } catch (error) {
    console.error(`Contract refresh failed for ${shopDomain}`, error);
  }

  // Fallback: store what the payload contains so the contract is never lost.
  const shop = await ensureShop(shopDomain);
  const status = String(value(payload, "status") || "ACTIVE").toUpperCase();
  const customerId = gid("Customer", value(payload, "admin_graphql_api_customer_id", "customer_id"));
  const data = {
    shopId: shop.id,
    status,
    currencyCode: String(value(payload, "currency_code") || "USD"),
    ...(customerId ? { customerId } : {}),
    ...(value(payload, "revision_id") ? { revisionId: String(value(payload, "revision_id")) } : {}),
    rawJson: JSON.stringify(payload).slice(0, 20_000),
  };
  return prisma.subscriptionContract.upsert({
    where: { shopifyId },
    create: { shopifyId, ...data },
    update: data,
  });
}

export async function syncBillingAttemptWebhook(shopDomain: string, topic: string, payload: JsonRecord) {
  const attemptId = gid("SubscriptionBillingAttempt", value(payload, "admin_graphql_api_id", "id"));
  if (!attemptId) return;
  const contractId = gid(
    "SubscriptionContract",
    value(payload, "admin_graphql_api_subscription_contract_id", "subscription_contract_id"),
  );
  const succeeded = topic.toLowerCase().endsWith("success");
  const errorCode = value(payload, "error_code", "error_message");

  try {
    const { admin } = await unauthenticated.admin(shopDomain);
    await recordBillingAttemptResult(shopDomain, admin, attemptId, {
      contractId,
      succeeded,
      errorCode: errorCode ? String(errorCode) : null,
    });
    return;
  } catch (error) {
    console.error(`Billing attempt lookup failed for ${shopDomain}`, error);
  }

  // Fallback when Shopify cannot be reached: record the outcome from the payload alone.
  const shop = await ensureShop(shopDomain);
  const contract = contractId
    ? await prisma.subscriptionContract.findUnique({ where: { shopifyId: contractId } })
    : null;
  const data = {
    shopId: shop.id,
    contractId: contract?.id ?? null,
    status: succeeded ? "SUCCESS" : "FAILURE",
    ready: true,
    errorCode: succeeded ? null : String(errorCode || "PAYMENT_FAILED").slice(0, 200),
    orderId: gid("Order", value(payload, "admin_graphql_api_order_id", "order_id")) ?? null,
  };
  const previous = await prisma.billingAttempt.findUnique({ where: { shopifyId: attemptId }, select: { status: true } });
  await prisma.billingAttempt.upsert({
    where: { shopifyId: attemptId },
    create: { shopifyId: attemptId, ...data },
    update: data,
  });
  if (!succeeded && previous?.status !== "FAILURE" && contractId) {
    void sendPaymentFailedEmail(shopDomain, contractId, attemptId).catch(() => undefined);
  }
  if (contract) {
    await prisma.subscriptionContract.update({
      where: { id: contract.id },
      data: { lastPaymentStatus: succeeded ? "SUCCEEDED" : "FAILED" },
    });
  }
}

export async function syncSellingPlanWebhook(shopDomain: string, topic: string, payload: JsonRecord) {
  const shopifyId = gid("SellingPlanGroup", value(payload, "admin_graphql_api_id", "id"));
  if (!shopifyId) return;
  const deleted = topic.toLowerCase().endsWith("delete");
  const merchantCode = value(payload, "merchant_code");
  const data = {
    shopDomain,
    name: String(value(payload, "name") || "Subscription plan"),
    merchantCode: merchantCode ? String(merchantCode) : null,
    status: deleted ? "DELETED" : "ACTIVE",
    rawJson: JSON.stringify(payload).slice(0, 20_000),
  };
  await prisma.sellingPlanCache.upsert({
    where: { shopifyId },
    create: { shopifyId, ...data },
    update: deleted ? { status: "DELETED" } : data,
  });
}
