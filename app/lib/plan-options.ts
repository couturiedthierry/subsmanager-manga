// Delivery-frequency options of a subscription plan (safe to use in the browser and on the server).

export type PlanInterval = "DAY" | "WEEK" | "MONTH" | "YEAR";

export type PlanOptionRow = {
  key: string;
  /** Existing Shopify selling plan ID, absent for new options. */
  id?: string;
  intervalCount: number;
  interval: PlanInterval;
  /** Percentage off; null keeps a non-percentage price adjustment that was set elsewhere. */
  discount: number | null;
};

export const INTERVALS: Array<{ value: PlanInterval; label: string }> = [
  { value: "DAY", label: "Day(s)" },
  { value: "WEEK", label: "Week(s)" },
  { value: "MONTH", label: "Month(s)" },
  { value: "YEAR", label: "Year(s)" },
];

export function optionLabel(intervalCount: number, interval: PlanInterval) {
  const unit = interval.toLowerCase();
  return `${intervalCount} ${unit}${intervalCount === 1 ? "" : "s"}`;
}

export function newRowKey() {
  return Math.random().toString(36).slice(2, 10);
}

export const MAX_PLAN_OPTIONS = 10;
