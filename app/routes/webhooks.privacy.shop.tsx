import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// shop/redact: delete all data stored for the shop (sent 48 hours after uninstall).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { shop } }),
    prisma.webhookEvent.deleteMany({ where: { shopDomain: shop } }),
    prisma.auditEvent.deleteMany({ where: { shopDomain: shop } }),
    prisma.sellingPlanCache.deleteMany({ where: { shopDomain: shop } }),
    prisma.shop.deleteMany({ where: { domain: shop } }),
  ]);
  return new Response(null, { status: 200 });
};
