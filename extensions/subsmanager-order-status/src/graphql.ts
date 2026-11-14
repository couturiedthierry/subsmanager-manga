export const ORDER_CONTRACTS_QUERY = `#graphql
  query SubsManagerOrderContracts($orderId: ID!) {
    order(id: $orderId) {
      subscriptionContracts(first: 10) {
        nodes { id status }
      }
    }
  }
`;

export const SETTINGS_QUERY = `#graphql
  query SubsManagerOrderStatusSettings {
    shop {
      metafield(namespace: "subsmanager", key: "settings") { value }
    }
  }
`;

export async function customerGraphql<T>(query: string, variables: Record<string, unknown> = {}) {
  const response = await fetch("shopify://customer-account/api/2026-04/graphql.json", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({query, variables}),
  });
  const body = (await response.json()) as {
    data?: T;
    errors?: {message: string}[];
  };
  if (!response.ok || body.errors?.length) {
    throw new Error(body.errors?.map(({message}) => message).join(" ") || "Shopify could not complete the request.");
  }
  return body.data as T;
}
