import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { isDuplicateWebhook, rememberWebhook, syncSellingPlanWebhook } from "../models/webhook.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic, webhookId } = await authenticate.webhook(request);
  if (await isDuplicateWebhook(webhookId)) return new Response(null, { status: 200 });
  await syncSellingPlanWebhook(shop, String(topic), payload);
  await rememberWebhook(webhookId, shop, String(topic), payload);
  return new Response(null, { status: 200 });
};
