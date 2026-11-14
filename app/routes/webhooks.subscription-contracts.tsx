import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { isDuplicateWebhook, rememberWebhook, syncContractWebhook } from "../models/webhook.server";
import { sendStatusChangeEmail, sendSubscriptionWelcomeEmail } from "../lib/subscription-email.server";

const STATUS_TOPICS: Record<string, string> = { pause: "PAUSED", activate: "ACTIVE", cancel: "CANCELLED" };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic, webhookId } = await authenticate.webhook(request);
  if (await isDuplicateWebhook(webhookId)) return new Response(null, { status: 200 });

  const event = String(topic).toLowerCase().replace(/^subscription_contracts[_/]/, "");
  const rawId = String(payload.admin_graphql_api_id || payload.id || "");
  const shopifyId = rawId.startsWith("gid://") ? rawId : `gid://shopify/SubscriptionContract/${rawId}`;
  const before = rawId
    ? await prisma.subscriptionContract.findUnique({ where: { shopifyId }, select: { status: true } })
    : null;

  const record = await syncContractWebhook(shop, payload);
  await rememberWebhook(webhookId, shop, String(topic), payload);

  // Emails must not hold up the webhook response (Shopify times out after 5 seconds).
  // Each email is recorded by key, so Shopify retries never send it twice.
  if (record && event === "create") {
    void sendSubscriptionWelcomeEmail(shop, record.shopifyId).catch((error) => {
      console.error(`Welcome email failed for ${shop}`, error);
    });
  }
  const newStatus = STATUS_TOPICS[event];
  // Only confirm a real change (for example, "activate" also fires for brand-new contracts).
  if (record && newStatus && before && before.status !== newStatus) {
    const revision = String(payload.revision_id || record.revisionId || webhookId || Date.now());
    void sendStatusChangeEmail(shop, record.shopifyId, newStatus, revision).catch((error) => {
      console.error(`Status email failed for ${shop}`, error);
    });
  }
  return new Response(null, { status: 200 });
};
