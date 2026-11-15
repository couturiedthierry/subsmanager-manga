/**
 * The subscription permissions need Shopify's approval. Until they are granted, the app keeps
 * working for everything else and shows a clear message where subscription data would appear.
 */
export const SUBSCRIPTION_SCOPES = ["read_own_subscription_contracts", "write_own_subscription_contracts"];

export function hasSubscriptionAccess(scope: string | null | undefined) {
  const granted = String(scope || "").split(",").map((value) => value.trim());
  return SUBSCRIPTION_SCOPES.some((needed) => granted.includes(needed));
}
