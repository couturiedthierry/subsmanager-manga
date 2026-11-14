import type { PlanInterval, PlanOptionRow } from "../lib/plan-options";
import { INTERVALS, MAX_PLAN_OPTIONS, newRowKey, optionLabel } from "../lib/plan-options";

/**
 * Editable list of delivery frequencies. The rows are posted as JSON in a hidden
 * "planOptions" field so they survive Polaris field quirks and can be validated server-side.
 */
export function PlanOptionsEditor({
  rows,
  onChange,
}: {
  rows: PlanOptionRow[];
  onChange: (rows: PlanOptionRow[]) => void;
}) {
  const update = (key: string, patch: Partial<PlanOptionRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const remove = (key: string) => onChange(rows.filter((row) => row.key !== key));
  const add = () => {
    const last = rows.at(-1);
    onChange([
      ...rows,
      {
        key: newRowKey(),
        intervalCount: last ? last.intervalCount + (last.interval === "DAY" ? 15 : 1) : 1,
        interval: last?.interval || "MONTH",
        discount: last?.discount ?? 10,
      },
    ]);
  };

  return (
    <s-stack direction="block" gap="base">
      <input
        type="hidden"
        name="planOptions"
        value={JSON.stringify(rows.map(({ key, id, intervalCount, interval, discount }) => ({ key, id, intervalCount, interval, discount })))}
      />
      {rows.map((row, index) => (
        <s-box key={row.key} padding="base" background="subdued" borderRadius="base">
          <s-stack direction="block" gap="small">
            <s-stack direction="inline" justifyContent="space-between" alignItems="center">
              <s-text type="strong">
                Option {index + 1}: every {optionLabel(row.intervalCount || 1, row.interval)}
                {row.discount ? `, save ${row.discount}%` : ""}
              </s-text>
              {rows.length > 1 ? (
                <s-button variant="tertiary" tone="critical" onClick={() => remove(row.key)}>
                  Remove
                </s-button>
              ) : null}
            </s-stack>
            <s-grid gridTemplateColumns="1fr 1.4fr 1fr" gap="base">
              <s-number-field
                label="Every"
                value={String(row.intervalCount)}
                min={1}
                max={365}
                onInput={(event) => update(row.key, { intervalCount: Number(event.currentTarget.value) || 1 })}
              ></s-number-field>
              <s-select
                label="Unit"
                value={row.interval}
                onChange={(event) => update(row.key, { interval: event.currentTarget.value as PlanInterval })}
              >
                {INTERVALS.map((interval) => (
                  <s-option key={interval.value} value={interval.value}>{interval.label}</s-option>
                ))}
              </s-select>
              {row.discount === null ? (
                <s-stack direction="block" gap="small-100">
                  <s-text color="subdued">Custom price kept</s-text>
                  <s-button variant="tertiary" onClick={() => update(row.key, { discount: 0 })}>Use a % discount</s-button>
                </s-stack>
              ) : (
                <s-number-field
                  label="Discount"
                  value={String(row.discount)}
                  min={0}
                  max={100}
                  suffix="%"
                  onInput={(event) => update(row.key, { discount: Number(event.currentTarget.value) || 0 })}
                ></s-number-field>
              )}
            </s-grid>
          </s-stack>
        </s-box>
      ))}
      {rows.length < MAX_PLAN_OPTIONS ? (
        <s-button onClick={add}>Add another frequency</s-button>
      ) : null}
      <s-paragraph color="subdued">
        Each frequency appears as a button on the product page with its own saving. Billing and
        delivery happen on the same schedule.
      </s-paragraph>
    </s-stack>
  );
}
