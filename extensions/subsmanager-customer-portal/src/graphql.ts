export const CONTRACTS_QUERY = `#graphql
  query SubsManagerCustomerContracts($first: Int!) {
    customer {
      subscriptionContracts(first: $first, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id
          status
          lastBillingAttemptErrorType
          currencyCode
          updatedAt
          deliveryPrice { amount currencyCode }
          deliveryPolicy {
            interval
            intervalCount { count precision }
          }
          upcomingBillingCycles(first: 3) {
            nodes { billingAttemptExpectedDate skipped cycleIndex }
          }
          orders(first: 1, reverse: true) {
            nodes { id totalPrice { amount currencyCode } }
          }
          lines(first: 10) {
            nodes {
              id
              name
              title
              variantTitle
              quantity
              image { altText url }
              lineDiscountedPrice { amount currencyCode }
            }
          }
        }
      }
    }
  }
`;

export const PAUSE_CONTRACT = `#graphql
  mutation SubsManagerCustomerPause($subscriptionContractId: ID!) {
    subscriptionContractPause(subscriptionContractId: $subscriptionContractId) {
      contract { id status }
      userErrors { field message }
    }
  }
`;

export const ACTIVATE_CONTRACT = `#graphql
  mutation SubsManagerCustomerActivate($subscriptionContractId: ID!) {
    subscriptionContractActivate(subscriptionContractId: $subscriptionContractId) {
      contract { id status }
      userErrors { field message }
    }
  }
`;

export const CANCEL_CONTRACT = `#graphql
  mutation SubsManagerCustomerCancel($subscriptionContractId: ID!) {
    subscriptionContractCancel(subscriptionContractId: $subscriptionContractId) {
      contract { id status }
      userErrors { field message }
    }
  }
`;

export const SKIP_BILLING_CYCLE = `#graphql
  mutation SubsManagerCustomerSkip($billingCycleInput: SubscriptionBillingCycleInput!) {
    subscriptionBillingCycleSkip(billingCycleInput: $billingCycleInput) {
      billingCycle { cycleIndex skipped billingAttemptExpectedDate }
      userErrors { field message }
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

export const SETTINGS_QUERY = `#graphql
  query SubsManagerPortalSettings {
    shop {
      metafield(namespace: "subsmanager", key: "settings") { value }
    }
  }
`;

export type PortalSettings = {
  enabled: boolean;
  pause: boolean;
  skip: boolean;
  cancel: boolean;
  payment: boolean;
  supportEmail: string | null;
};

export const DEFAULT_SETTINGS: PortalSettings = {
  enabled: true,
  pause: true,
  skip: true,
  cancel: true,
  payment: true,
  supportEmail: null,
};

/** Reads the merchant's portal switches. Anything missing or unreadable means "allowed". */
export async function loadPortalSettings(): Promise<PortalSettings> {
  try {
    const data = await customerGraphql<{shop: {metafield: {value: string} | null}}>(SETTINGS_QUERY);
    const raw = data.shop.metafield?.value;
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as {portal?: Partial<PortalSettings>; supportEmail?: string | null};
    const portal = parsed.portal || {};
    return {
      enabled: portal.enabled !== false,
      pause: portal.pause !== false,
      skip: portal.skip !== false,
      cancel: portal.cancel !== false,
      payment: portal.payment !== false,
      supportEmail: parsed.supportEmail || null,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
