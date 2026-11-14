import type { PlanInterval, PlanOptionRow } from "./plan-options";
import { MAX_PLAN_OPTIONS, optionLabel } from "./plan-options";

const VALID_INTERVALS: PlanInterval[] = ["DAY", "WEEK", "MONTH", "YEAR"];

/** Parses and validates the frequency rows posted by the plan editor. */
export function parsePlanOptions(raw: FormDataEntryValue | null): { rows: PlanOptionRow[] } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw || "[]"));
  } catch {
    return { error: "The delivery options could not be read. Reload the page and try again." };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return { error: "Add at least one delivery frequency" };
  if (parsed.length > MAX_PLAN_OPTIONS) return { error: `A plan can have up to ${MAX_PLAN_OPTIONS} delivery frequencies` };

  const rows: PlanOptionRow[] = [];
  const labels = new Set<string>();
  for (const item of parsed as Array<Record<string, unknown>>) {
    const intervalCount = Number(item.intervalCount);
    const interval = String(item.interval) as PlanInterval;
    const discount = item.discount === null ? null : Number(item.discount);
    if (!Number.isInteger(intervalCount) || intervalCount < 1 || intervalCount > 365) {
      return { error: "Each frequency must be a whole number between 1 and 365" };
    }
    if (!VALID_INTERVALS.includes(interval)) return { error: "Choose days, weeks, months, or years" };
    if (discount !== null && (!Number.isFinite(discount) || discount < 0 || discount > 100)) {
      return { error: "Each discount must be between 0 and 100%" };
    }
    const label = optionLabel(intervalCount, interval);
    if (labels.has(label)) return { error: `"Every ${label}" is listed twice` };
    labels.add(label);
    rows.push({
      key: String(item.key || ""),
      id: typeof item.id === "string" && item.id.startsWith("gid://shopify/SellingPlan/") ? item.id : undefined,
      intervalCount,
      interval,
      discount,
    });
  }
  return { rows };
}

/** Builds a Shopify SellingPlanInput for one frequency row. */
export function sellingPlanInput(row: PlanOptionRow, position: number) {
  const label = optionLabel(row.intervalCount, row.interval);
  const discount = row.discount ?? 0;
  return {
    ...(row.id ? { id: row.id } : {}),
    name: discount > 0 ? `Deliver every ${label}, save ${discount}%` : `Deliver every ${label}`,
    options: [label],
    position,
    category: "SUBSCRIPTION",
    billingPolicy: { recurring: { interval: row.interval, intervalCount: row.intervalCount } },
    deliveryPolicy: { recurring: { interval: row.interval, intervalCount: row.intervalCount } },
    // null means "keep the existing price adjustment": leave pricingPolicies out entirely.
    ...(row.discount === null
      ? {}
      : {
          pricingPolicies: discount > 0
            ? [{ fixed: { adjustmentType: "PERCENTAGE", adjustmentValue: { percentage: discount } } }]
            : [],
        }),
  };
}

export const PLAN_GROUP_OPTION_NAME = "Deliver every";
