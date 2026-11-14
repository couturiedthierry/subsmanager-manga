import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// customers/data_request: this app stores only the contract mirror Shopify already holds
// (customer GID, display name, line titles). Merchants retrieve customer data from Shopify,
// so acknowledging the request is sufficient.
// customers/redact: delete every locally stored record for the customer.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);

  if (String(topic).toUpperCase() === "CUSTOMERS_REDACT") {
    const customer = payload.customer as { id?: string | number } | undefined;
    const numeric = customer?.id ? String(customer.id).split("/").at(-1) : "";
    if (numeric) {
      await prisma.subscriptionContract.deleteMany({
        where: {
          shop: { domain: shop },
          customerId: { in: [numeric, `gid://shopify/Customer/${numeric}`] },
        },
      });
    }
  }
  return new Response(null, { status: 200 });
};
