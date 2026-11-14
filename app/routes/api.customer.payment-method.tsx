import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { graphqlRequest, throwOnUserErrors } from "../lib/graphql.server";
import { CUSTOMER_CONTRACT_OWNERSHIP_QUERY, SEND_PAYMENT_UPDATE_EMAIL } from "../lib/shopify-queries";

type OwnershipData = {
  subscriptionContract: {
    id: string;
    customer: {
      id: string;
      defaultEmailAddress: { emailAddress: string } | null;
    };
    customerPaymentMethod: { id: string } | null;
  } | null;
};

type PaymentEmailData = {
  customerPaymentMethodSendUpdateEmail: {
    customer: { id: string } | null;
    userErrors: Array<{ field?: string[]; message: string }>;
  };
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method !== "OPTIONS") return new Response("Method not allowed", { status: 405 });
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { sessionToken, cors } = await authenticate.public.customerAccount(request);
  const body = (await request.json()) as { contractId?: string };
  if (!body.contractId) return cors(json({ error: "Missing contract ID" }, 400));
  const shopDomain = new URL(String(sessionToken.dest)).hostname;
  const customerId = String(sessionToken.sub || "");
  const { admin } = await unauthenticated.admin(shopDomain);

  try {
    const ownership = await graphqlRequest<OwnershipData>(admin, CUSTOMER_CONTRACT_OWNERSHIP_QUERY, {
      id: body.contractId,
    });
    const contract = ownership.subscriptionContract;
    if (!contract || contract.customer.id !== customerId) {
      return cors(json({ error: "Subscription not found" }, 404));
    }
    if (!contract.customerPaymentMethod) {
      return cors(json({ error: "No payment method is available" }, 409));
    }
    const result = await graphqlRequest<PaymentEmailData>(admin, SEND_PAYMENT_UPDATE_EMAIL, {
      customerPaymentMethodId: contract.customerPaymentMethod.id,
      emailInput: null,
    });
    throwOnUserErrors(result.customerPaymentMethodSendUpdateEmail.userErrors);
    return cors(json({ ok: true }));
  } catch (error) {
    return cors(json({ error: error instanceof Error ? error.message : "Unable to send email" }, 500));
  }
};
