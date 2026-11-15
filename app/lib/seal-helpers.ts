/** Seal data types and display helpers. Safe to use in the browser (no secrets, no network). */

export type SealBillingAttempt = {
  id: number;
  date: string;
  completed_at: string;
  status: string;
  order_id: string;
  error_code: string;
  error_message: string;
  triggered_manually: string | number;
};

export type SealItem = {
  id: number;
  product_id: string;
  variant_id: string;
  title: string;
  variant_sku?: string;
  quantity: number;
  price: string;
  final_price?: string | number;
  final_amount?: number;
  selling_plan_id?: string;
  selling_plan_name?: string;
  is_one_time_item?: number;
};

export type SealSubscription = {
  id: number;
  internal_id?: number;
  order_placed?: string;
  delivery_interval?: string;
  billing_interval?: string;
  order_id?: string;
  email?: string;
  currency?: string;
  first_name?: string;
  last_name?: string;
  total_value?: number | string;
  status: string;
  customer_id?: string;
  cancelled_on?: string;
  paused_on?: string;
  card_brand?: string;
  card_expiry_month?: string;
  card_expiry_year?: string;
  card_last_digits?: string;
  s_address1?: string;
  s_city?: string;
  s_province_code?: string;
  s_zip?: string;
  s_country_code?: string;
  delivery_method_title?: string;
  delivery_price?: number | string;
  items?: SealItem[];
  billing_attempts?: SealBillingAttempt[];
  log?: Array<{ content: string; created: string }>;
};

export type SealSellingPlan = {
  name: string;
  option: string;
  delivery_interval: string;
  delivery_interval_count: number;
  billing_interval: string;
  billing_interval_count: number;
  pricing_policy_fixed_adjustment_type: string;
  pricing_policy_fixed_adjustment_value: string | number;
  selling_plan_id: string;
};

export type SealRule = {
  id: number;
  name: string;
  option: string;
  payment_type: string;
  product_variants: Array<{ product_id: string | number; variant_id: string | number | null }>;
  selling_plans: SealSellingPlan[];
};

export type SealStatusFilter = "" | "ACTIVE" | "PAUSED" | "CANCELLED";

/** Helpers shared by the Seal pages. */
export function sealCustomerName(subscription: SealSubscription) {
  const name = [subscription.first_name, subscription.last_name].filter(Boolean).join(" ").trim();
  return name || subscription.email || "Customer";
}

export function sealAmount(subscription: SealSubscription) {
  const total = Number(subscription.total_value);
  if (Number.isFinite(total) && total > 0) return total;
  return (subscription.items || []).reduce((sum, item) => {
    const amount = Number(item.final_amount ?? Number(item.final_price ?? item.price) * Number(item.quantity || 1));
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
}

/** Upcoming attempts are the ones Seal has not processed yet ("" status, no completion date). */
export function sealUpcomingAttempts(subscription: SealSubscription) {
  return (subscription.billing_attempts || [])
    .filter((attempt) => !attempt.completed_at && !attempt.order_id && attempt.status !== "skipped" && attempt.status !== "SKIPPED")
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export function sealSkippedAttempts(subscription: SealSubscription) {
  return (subscription.billing_attempts || []).filter((attempt) => String(attempt.status).toLowerCase() === "skipped");
}

export function sealPastAttempts(subscription: SealSubscription) {
  return (subscription.billing_attempts || [])
    .filter((attempt) => attempt.completed_at || attempt.order_id || (attempt.status && String(attempt.status).toLowerCase() !== "skipped"))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function sealNextBillingDate(subscription: SealSubscription) {
  if (subscription.status !== "ACTIVE") return null;
  return sealUpcomingAttempts(subscription)[0]?.date || null;
}

export function sealPlanDiscountLabel(plan: SealSellingPlan) {
  const value = Number(plan.pricing_policy_fixed_adjustment_value);
  if (!plan.pricing_policy_fixed_adjustment_type || !Number.isFinite(value) || value === 0) return "No discount";
  if (plan.pricing_policy_fixed_adjustment_type.toLowerCase().includes("percent")) return `${value}% off`;
  return `${value} off`;
}

export function sealPlanFrequencyLabel(plan: SealSellingPlan) {
  const count = Number(plan.delivery_interval_count || 1);
  const unit = String(plan.delivery_interval || "").toLowerCase();
  return `Every ${count === 1 ? "" : `${count} `}${unit}${count === 1 ? "" : "s"}`.replace("Every  ", "Every ");
}
