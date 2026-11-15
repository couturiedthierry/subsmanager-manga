import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Remove the access tokens immediately. Store records stay so a reinstall keeps its settings
// and history; Shopify sends shop/redact 48 hours after uninstall, which deletes everything.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);
  await db.session.deleteMany({ where: { shop } });
  // The Seal API token is a credential too, so it is removed with the access tokens.
  await db.shop.updateMany({ where: { domain: shop }, data: { sealToken: null, sealConnectedAt: null } });
  return new Response();
};
