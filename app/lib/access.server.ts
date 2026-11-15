/**
 * The app bills through Seal Subscriptions. These two permissions would only be present if the app
 * were ever granted Shopify's own subscription access; then it would use Shopify-native subscriptions.
 */
export const SUBSCRIPTION_SCOPES = ["read_own_subscription_contracts", "write_own_subscription_contracts"];

export function hasSubscriptionAccess(scope: string | null | undefined) {
  const granted = String(scope || "").split(",").map((value) => value.trim());
  return SUBSCRIPTION_SCOPES.some((needed) => granted.includes(needed));
}

/** Permissions this app asks for (keep in sync with shopify.app.toml). */
export const REQUIRED_SCOPES = ["read_orders", "read_products", "write_customers", "write_products", "write_purchase_options"];
