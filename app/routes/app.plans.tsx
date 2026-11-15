import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useEffect } from "react";
import { authenticate } from "../shopify.server";
import { graphqlRequest, throwOnUserErrors } from "../lib/graphql.server";
import { DELETE_SELLING_PLAN_GROUP, PLANS_QUERY } from "../lib/shopify-queries";
import { hasSubscriptionAccess } from "../lib/access.server";
import { getSealClient } from "../models/seal-connection.server";
import { SealApiError } from "../lib/seal.server";
import { SubscriptionAccessBanner } from "../components/subscription-access-banner";
import { sealPlanDiscountLabel, sealPlanFrequencyLabel, type SealRule } from "../lib/seal-helpers";

type PlansData = {
  sellingPlanGroups: {
    nodes: Array<{
      id: string;
      name: string;
      merchantCode: string;
      createdAt: string;
      productsCount: { count: number };
      productVariantsCount: { count: number };
      sellingPlans: {
        nodes: Array<{
          id: string;
          name: string;
          options: string[];
          billingPolicy?: { interval: string; intervalCount: number };
          pricingPolicies: Array<{
            adjustmentType: string;
            adjustmentValue?: { percentage?: number; amount?: string; currencyCode?: string };
          }>;
        }>;
      };
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

type DeleteResult = {
  sellingPlanGroupDelete: {
    deletedSellingPlanGroupId: string | null;
    userErrors: Array<{ field?: string[]; message: string }>;
  };
};

async function loadSealRules(shopDomain: string) {
  const client = await getSealClient(shopDomain);
  if (!client) return { connected: false, rules: [] as SealRule[], error: null as string | null };
  try {
    const rules: SealRule[] = [];
    // Seal pages its rules; five pages is far more than a store normally has.
    for (let page = 1; page <= 5; page += 1) {
      const result = await client.listRules(page);
      rules.push(...result.subscription_rules);
      if (page >= result.total_pages) break;
    }
    return { connected: true, rules, error: null };
  } catch (error) {
    return {
      connected: true,
      rules: [] as SealRule[],
      error: error instanceof SealApiError ? error.message : "Could not load plans from Seal",
    };
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [data, seal] = await Promise.all([
    graphqlRequest<PlansData>(admin, PLANS_QUERY, { first: 50 }),
    loadSealRules(session.shop),
  ]);
  return {
    nodes: data.sellingPlanGroups.nodes,
    seal,
    subscriptionAccess: hasSubscriptionAccess(session.scope),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  if (formData.get("intent") === "seal-add-products") {
    const client = await getSealClient(session.shop);
    if (!client) return { ok: false, error: "Seal is not connected" };
    const ruleId = Number(formData.get("ruleId"));
    let productIds: string[] = [];
    try {
      productIds = JSON.parse(String(formData.get("productIds") || "[]"));
    } catch {
      productIds = [];
    }
    const products = productIds
      .map((id) => String(id).split("/").at(-1) || "")
      .filter((id) => /^\d+$/.test(id))
      .map((id) => ({ product_id: id, variant_id: null }));
    if (!Number.isSafeInteger(ruleId) || ruleId <= 0 || products.length === 0) {
      return { ok: false, error: "Choose at least one product" };
    }
    try {
      // Seal refuses the whole request if any product is already in the plan, so send only new ones.
      const rule = await client.getRule(ruleId);
      const already = new Set(
        (rule?.product_variants || [])
          .filter((entry) => entry.variant_id === null || entry.variant_id === "" || entry.variant_id === undefined)
          .map((entry) => String(entry.product_id)),
      );
      const fresh = products.filter((product) => !already.has(product.product_id));
      if (fresh.length === 0) return { ok: true, message: "Those products are already in this Seal plan" };
      await client.appendRuleProducts(ruleId, fresh);
      const skipped = products.length - fresh.length;
      return {
        ok: true,
        message: `${fresh.length} product${fresh.length === 1 ? "" : "s"} added to the Seal plan${skipped ? ` (${skipped} already in it)` : ""}`,
      };
    } catch (error) {
      return { ok: false, error: error instanceof SealApiError ? error.message : "Seal could not add the products" };
    }
  }

  const id = String(formData.get("id") || "");
  if (!id) return { ok: false, error: "Missing selling plan group ID" };

  try {
    const data = await graphqlRequest<DeleteResult>(admin, DELETE_SELLING_PLAN_GROUP, { id });
    throwOnUserErrors(data.sellingPlanGroupDelete.userErrors);
    return { ok: true, message: "Selling plan deleted" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to delete plan" };
  }
};

export default function Plans() {
  const { nodes: plans, seal, subscriptionAccess } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  useEffect(() => {
    if (fetcher.data?.message) shopify.toast.show(fetcher.data.message);
    if (fetcher.data?.error) shopify.toast.show(fetcher.data.error, { isError: true });
  }, [fetcher.data, shopify]);

  return (
    <s-page heading="Plans">
      {subscriptionAccess ? (
        <s-button slot="primary-action" variant="primary" href="/app/plans/new">Create plan</s-button>
      ) : seal.connected ? (
        <s-button slot="primary-action" variant="primary" href="shopify://admin/apps/seal-subscriptions">
          Create plan in Seal
        </s-button>
      ) : (
        <s-button slot="primary-action" variant="primary" href="/app/seal">Connect Seal</s-button>
      )}
      <s-button slot="secondary-actions" href="shopify://admin/products">
        View products
      </s-button>

      {seal.connected ? (
        <s-section heading="Seal plans">
          <s-stack direction="block" gap="base">
            {seal.error ? <s-banner tone="critical">{seal.error}</s-banner> : null}
            <s-paragraph color="subdued">
              These plans are billed by Seal Subscriptions. Create new ones in Seal (Subscription rules),
              then add products to them here.
            </s-paragraph>
            {seal.rules.length === 0 && !seal.error ? (
              <s-paragraph>No Seal plans yet.</s-paragraph>
            ) : (
              <s-table variant="auto">
                <s-table-header-row>
                  <s-table-header listSlot="primary">Plan</s-table-header>
                  <s-table-header>Delivery options</s-table-header>
                  <s-table-header>Discount</s-table-header>
                  <s-table-header format="numeric">Products</s-table-header>
                  <s-table-header>Actions</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {seal.rules.map((rule) => (
                    <s-table-row key={rule.id}>
                      <s-table-cell>
                        <s-stack direction="block" gap="small-100">
                          <s-text type="strong">{rule.name}</s-text>
                          <s-text color="subdued">{rule.payment_type === "auto-charge" ? "Charged automatically" : rule.payment_type}</s-text>
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        {rule.selling_plans.length ? rule.selling_plans.map(sealPlanFrequencyLabel).join(", ") : "—"}
                      </s-table-cell>
                      <s-table-cell>
                        {rule.selling_plans.length
                          ? Array.from(new Set(rule.selling_plans.map(sealPlanDiscountLabel))).join(", ")
                          : "—"}
                      </s-table-cell>
                      <s-table-cell>{rule.product_variants.length}</s-table-cell>
                      <s-table-cell>
                        <s-button
                          variant="tertiary"
                          disabled={fetcher.state !== "idle"}
                          loading={fetcher.state !== "idle" && fetcher.formData?.get("ruleId") === String(rule.id)}
                          onClick={async () => {
                            const selected = await shopify.resourcePicker({ type: "product", multiple: true, action: "add" });
                            if (!selected || selected.length === 0) return;
                            fetcher.submit(
                              {
                                intent: "seal-add-products",
                                ruleId: String(rule.id),
                                productIds: JSON.stringify(selected.map((product) => product.id)),
                              },
                              { method: "POST" },
                            );
                          }}
                        >
                          Add products
                        </s-button>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}
            <s-button href="shopify://admin/apps/seal-subscriptions">Open Seal to create a plan</s-button>
          </s-stack>
        </s-section>
      ) : null}

      {!subscriptionAccess && !seal.connected ? <SubscriptionAccessBanner /> : null}

      {!subscriptionAccess && plans.length > 0 ? (
        <s-banner tone="warning" heading="Plans that can’t be billed">
          These older plans were created by SubsManager Manga itself and can’t bill customers. Delete them
          and sell with Seal plans instead.
        </s-banner>
      ) : null}

      {subscriptionAccess || plans.length > 0 ? (
      <s-section heading={seal.connected ? "SubsManager Manga plans" : undefined}>
        {plans.length === 0 ? (
          <s-box padding="large" background="subdued" borderRadius="base">
            <s-stack direction="block" gap="base" alignItems="center">
              <s-icon type="product" size="base" color="subdued"></s-icon>
              <s-heading>Create a recurring offer</s-heading>
              <s-paragraph color="subdued">
                Add delivery frequency, pricing, and products. Shopify will display the plan at checkout.
              </s-paragraph>
              <s-button variant="primary" href="/app/plans/new">
                Create plan
              </s-button>
            </s-stack>
          </s-box>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Plan</s-table-header>
              <s-table-header>Delivery options</s-table-header>
              <s-table-header>Discount</s-table-header>
              <s-table-header format="numeric">Products</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {plans.map((plan) => {
                const offers = plan.sellingPlans.nodes;
                const frequencies = offers
                  .filter((offer) => offer.billingPolicy)
                  .map((offer) => {
                    const count = offer.billingPolicy!.intervalCount;
                    const unit = offer.billingPolicy!.interval.toLowerCase();
                    return `${count} ${unit}${count === 1 ? "" : "s"}`;
                  });
                const percentages = offers
                  .map((offer) => offer.pricingPolicies[0]?.adjustmentValue?.percentage || 0)
                  .filter((value) => value > 0);
                const best = percentages.length ? Math.max(...percentages) : 0;
                const fixedPolicy = offers
                  .map((offer) => offer.pricingPolicies[0])
                  .find((policy) => policy && policy.adjustmentType !== "PERCENTAGE" && policy.adjustmentValue?.amount);
                return (
                  <s-table-row key={plan.id}>
                    <s-table-cell>
                      <s-stack direction="block" gap="small-100">
                        <s-text type="strong">{plan.name}</s-text>
                        <s-text color="subdued">{plan.merchantCode}</s-text>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      {frequencies.length ? `Every ${frequencies.join(", ")}` : "Recurring"}
                    </s-table-cell>
                    <s-table-cell>
                      {best
                        ? `${percentages.length > 1 && new Set(percentages).size > 1 ? "Up to " : ""}${best}% off`
                        : fixedPolicy
                          ? `${fixedPolicy.adjustmentType === "PRICE" ? "Fixed price" : "Amount off"} ${fixedPolicy.adjustmentValue?.amount}`
                          : "—"}
                    </s-table-cell>
                    <s-table-cell>{plan.productsCount.count}</s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small">
                        <s-button
                          variant="tertiary"
                          href={`/app/plans/${plan.id.split("/").at(-1)}/edit`}
                        >
                          Edit
                        </s-button>
                        <s-button
                          variant="tertiary"
                          tone="critical"
                          loading={fetcher.state !== "idle" && fetcher.formData?.get("id") === plan.id}
                          disabled={fetcher.state !== "idle"}
                          onClick={() => {
                            if (
                              window.confirm(
                                "Delete this selling plan? Existing subscription contracts will remain, but customers cannot select this plan again.",
                              )
                            ) {
                              fetcher.submit({ id: plan.id }, { method: "POST" });
                            }
                          }}
                        >
                          Delete
                        </s-button>
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
      </s-section>
      ) : null}

      <s-section slot="aside" heading="How plans work">
        <s-paragraph>
          {subscriptionAccess
            ? "Every offer is stored as a Shopify selling plan group. Checkout, payment vaulting, taxes, and the resulting subscription contract stay inside Shopify."
            : "Plans are created in Seal Subscriptions and shown on your product pages by the SubsManager Manga widget. Seal processes the payments; you approve each renewal here."}
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
