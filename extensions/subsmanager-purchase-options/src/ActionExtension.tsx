import "@shopify/ui-extensions/preact";
import {render} from "preact";
import {useEffect, useMemo, useState} from "preact/hooks";

type Interval = "DAY" | "WEEK" | "MONTH" | "YEAR";
type SelectedResource = {id: string; sellingPlanId?: string};
type UserError = {field?: string[]; message: string};
type GroupQueryResult = {
  data?: {
    sellingPlanGroup?: {
      name: string;
      sellingPlans: {
        nodes: Array<{
          id: string;
          billingPolicy?: {interval?: string; intervalCount?: number};
          pricingPolicies?: Array<{
            adjustmentType?: string;
            adjustmentValue?: {percentage?: number};
          }>;
        }>;
      };
    };
  };
  errors?: Array<{message: string}>;
};
type MutationPayload = {userErrors?: UserError[]};
type MutationResult = {
  data?: {
    sellingPlanGroupCreate?: MutationPayload;
    sellingPlanGroupUpdate?: MutationPayload;
    sellingPlanGroupRemoveProducts?: MutationPayload;
    sellingPlanGroupRemoveProductVariants?: MutationPayload;
  };
  errors?: Array<{message: string}>;
};

const api = shopify;

const GROUP_QUERY = `#graphql
  query SubsManagerPurchaseOption($id: ID!) {
    sellingPlanGroup(id: $id) {
      id
      name
      sellingPlans(first: 1) {
        nodes {
          id
          billingPolicy {
            ... on SellingPlanRecurringBillingPolicy {
              interval
              intervalCount
            }
          }
          pricingPolicies {
            ... on SellingPlanFixedPricingPolicy {
              adjustmentType
              adjustmentValue {
                ... on SellingPlanPricingPolicyPercentageValue {
                  percentage
                }
              }
            }
          }
        }
      }
    }
  }
`;

const CREATE_GROUP = `#graphql
  mutation SubsManagerCreatePurchaseOption(
    $input: SellingPlanGroupInput!
    $resources: SellingPlanGroupResourceInput
  ) {
    sellingPlanGroupCreate(input: $input, resources: $resources) {
      sellingPlanGroup { id }
      userErrors { field message }
    }
  }
`;

const UPDATE_GROUP = `#graphql
  mutation SubsManagerUpdatePurchaseOption($id: ID!, $input: SellingPlanGroupInput!) {
    sellingPlanGroupUpdate(id: $id, input: $input) {
      sellingPlanGroup { id }
      userErrors { field message }
    }
  }
`;

const REMOVE_PRODUCT = `#graphql
  mutation SubsManagerRemoveProductFromPurchaseOption($id: ID!, $productIds: [ID!]!) {
    sellingPlanGroupRemoveProducts(id: $id, productIds: $productIds) {
      removedProductIds
      userErrors { field message }
    }
  }
`;

const REMOVE_VARIANT = `#graphql
  mutation SubsManagerRemoveVariantFromPurchaseOption($id: ID!, $productVariantIds: [ID!]!) {
    sellingPlanGroupRemoveProductVariants(id: $id, productVariantIds: $productVariantIds) {
      removedProductVariantIds
      userErrors { field message }
    }
  }
`;

export default async () => {
  render(<PurchaseOptionAction />, document.body);
};

function PurchaseOptionAction() {
  const selected = (api.data.selected?.[0] ?? null) as SelectedResource | null;
  const groupId = selected?.sellingPlanId || "";
  const [name, setName] = useState("Subscribe & save");
  const [interval, setInterval] = useState<Interval>("MONTH");
  const [intervalCount, setIntervalCount] = useState("1");
  const [discount, setDiscount] = useState("10");
  const [sellingPlanId, setSellingPlanId] = useState("");
  const [loading, setLoading] = useState(Boolean(groupId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function loadGroup(id: string) {
    try {
      const body = (await api.query(GROUP_QUERY, {variables: {id}})) as GroupQueryResult;
      if (body.errors?.length) throw new Error(body.errors[0].message);
      const group = body.data?.sellingPlanGroup;
      const plan = group?.sellingPlans?.nodes?.[0];
      if (!group || !plan) throw new Error("This purchase option could not be loaded.");
      const policy = plan.billingPolicy;
      const fixedDiscount = plan.pricingPolicies?.find(
        (policy: {adjustmentType?: string}) => policy.adjustmentType === "PERCENTAGE",
      );
      setName(group.name);
      setSellingPlanId(plan.id);
      setInterval((policy?.interval || "MONTH") as Interval);
      setIntervalCount(String(policy?.intervalCount || 1));
      setDiscount(String(fixedDiscount?.adjustmentValue?.percentage || 0));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load this purchase option.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!groupId) return;
    void loadGroup(groupId);
  }, [groupId]);

  const summary = useMemo(() => {
    const count = Math.max(1, Number(intervalCount) || 1);
    const unit = interval.toLowerCase();
    return `Charge and deliver every ${count} ${unit}${count === 1 ? "" : "s"}`;
  }, [interval, intervalCount]);

  async function save() {
    if (!selected?.id) {
      setError("No product or variant was supplied by Shopify.");
      return;
    }
    const count = Number(intervalCount);
    const discountValue = Number(discount);
    if (!name.trim() || !Number.isInteger(count) || count < 1 || discountValue < 0 || discountValue > 100) {
      setError("Enter a name, a whole-number interval, and a discount from 0 to 100%.");
      return;
    }

    setSaving(true);
    setError("");
    const optionText = `Every ${count} ${interval.toLowerCase()}${count === 1 ? "" : "s"}`;
    const planInput = {
      ...(sellingPlanId ? {id: sellingPlanId} : {}),
      name: discountValue > 0 ? `${optionText}, save ${discountValue}%` : optionText,
      options: [optionText],
      category: "SUBSCRIPTION",
      billingPolicy: {recurring: {interval, intervalCount: count}},
      deliveryPolicy: {recurring: {interval, intervalCount: count}},
      // An empty list removes an old discount when the merchant sets 0%.
      pricingPolicies:
        discountValue > 0
          ? [
              {
                fixed: {
                  adjustmentType: "PERCENTAGE",
                  adjustmentValue: {percentage: discountValue},
                },
              },
            ]
          : [],
    };
    const input = {
      name: name.trim(),
      ...(groupId ? {} : {merchantCode: name.trim()}),
      options: ["Delivery frequency"],
      position: 1,
      ...(groupId
        ? {sellingPlansToUpdate: [planInput]}
        : {sellingPlansToCreate: [planInput]}),
    };
    const variables = groupId
      ? {id: groupId, input}
      : {
          input,
          resources: selected.id.includes("ProductVariant")
            ? {productVariantIds: [selected.id]}
            : {productIds: [selected.id]},
        };

    try {
      const body = (await api.query(groupId ? UPDATE_GROUP : CREATE_GROUP, {variables})) as MutationResult;
      const payload = groupId ? body.data?.sellingPlanGroupUpdate : body.data?.sellingPlanGroupCreate;
      const errors = [...(body.errors || []), ...(payload?.userErrors || [])] as UserError[];
      if (errors.length) throw new Error(errors.map(({message}) => message).join(" "));
      api.close();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save the subscription plan.");
    } finally {
      setSaving(false);
    }
  }

  async function removeFromResource() {
    if (!groupId || !selected?.id) return;
    // Admin extensions have no window.confirm; ask for a second click instead.
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    setSaving(true);
    setError("");
    const isVariant = selected.id.includes("ProductVariant");
    try {
      const body = (await api.query(isVariant ? REMOVE_VARIANT : REMOVE_PRODUCT, {
        variables: isVariant
          ? { id: groupId, productVariantIds: [selected.id] }
          : { id: groupId, productIds: [selected.id] },
      })) as MutationResult;
      const payload = isVariant
        ? body.data?.sellingPlanGroupRemoveProductVariants
        : body.data?.sellingPlanGroupRemoveProducts;
      const errors = [...(body.errors || []), ...(payload?.userErrors || [])] as UserError[];
      if (errors.length) throw new Error(errors.map(({message}) => message).join(" "));
      api.close();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Unable to remove this subscription plan.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <s-admin-action heading="Loading subscription plan">
        <s-stack alignItems="center" padding="large-400">
          <s-spinner accessibilityLabel="Loading subscription plan" />
        </s-stack>
      </s-admin-action>
    );
  }

  return (
    <s-admin-action heading={groupId ? "Edit subscription plan" : "Create subscription plan"}>
      <s-button slot="primary-action" variant="primary" loading={saving} onClick={save}>
        {groupId ? "Save changes" : "Create plan"}
      </s-button>
      <s-button slot="secondary-actions" disabled={saving} onClick={() => api.close()}>
        Cancel
      </s-button>
      <s-stack direction="block" gap="base">
        {error ? <s-banner tone="critical">{error}</s-banner> : null}
        <s-text-field
          label="Plan name"
          value={name}
          onInput={(event) => setName(event.currentTarget.value)}
          required
        />
        <s-grid gridTemplateColumns="1fr 2fr" gap="base">
          <s-number-field
            label="Every"
            value={intervalCount}
            min={1}
            step={1}
            onInput={(event) => setIntervalCount(event.currentTarget.value)}
            required
          />
          <s-select
            label="Interval"
            value={interval}
            onChange={(event) => setInterval(event.currentTarget.value as Interval)}
          >
            <s-option value="DAY">Day(s)</s-option>
            <s-option value="WEEK">Week(s)</s-option>
            <s-option value="MONTH">Month(s)</s-option>
            <s-option value="YEAR">Year(s)</s-option>
          </s-select>
        </s-grid>
        <s-number-field
          label="Subscriber discount"
          details="Applied to every recurring order. Use 0 for no discount."
          value={discount}
          min={0}
          max={100}
          suffix="%"
          onInput={(event) => setDiscount(event.currentTarget.value)}
        />
        <s-section heading="Customer offer">
          <s-stack direction="block" gap="small-200">
            <s-text type="strong">{name || "Subscription"}</s-text>
            <s-text>{summary}</s-text>
            <s-text color="subdued">
              {Number(discount) > 0 ? `Customers save ${discount}% on every order.` : "No recurring discount."}
            </s-text>
          </s-stack>
        </s-section>
        {groupId ? (
          <s-section heading="Remove from this product">
            <s-stack direction="block" gap="small-200">
              <s-text color="subdued">Existing customer contracts continue unchanged.</s-text>
              {confirmRemove ? (
                <s-banner tone="warning" heading="Remove this purchase option?">
                  <s-stack direction="inline" gap="small-200">
                    <s-button tone="critical" variant="primary" disabled={saving} onClick={removeFromResource}>Yes, remove</s-button>
                    <s-button disabled={saving} onClick={() => setConfirmRemove(false)}>Keep it</s-button>
                  </s-stack>
                </s-banner>
              ) : (
                <s-button tone="critical" disabled={saving} onClick={removeFromResource}>Remove purchase option</s-button>
              )}
            </s-stack>
          </s-section>
        ) : null}
      </s-stack>
    </s-admin-action>
  );
}
