import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Remove the access tokens immediately. Store records stay so a reinstall keeps its settings
// and history; Shopify sends shop/redact 48 hours after uninstall, which deletes everything.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);
  await db.session.deleteMany({ where: { shop } });
  return new Response();
};
