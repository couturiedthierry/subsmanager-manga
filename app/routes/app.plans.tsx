import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useEffect } from "react";
import { authenticate } from "../shopify.server";
import { graphqlRequest, throwOnUserErrors } from "../lib/graphql.server";
import { DELETE_SELLING_PLAN_GROUP, PLANS_QUERY } from "../lib/shopify-queries";

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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const data = await graphqlRequest<PlansData>(admin, PLANS_QUERY, { first: 50 });
  return data.sellingPlanGroups;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
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
  const { nodes: plans } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  useEffect(() => {
    if (fetcher.data?.message) shopify.toast.show(fetcher.data.message);
    if (fetcher.data?.error) shopify.toast.show(fetcher.data.error, { isError: true });
  }, [fetcher.data, shopify]);

  return (
    <s-page heading="Selling plans">
      <s-button
        slot="primary-action"
        variant="primary"
        href="/app/plans/new"
      >
        Create plan
      </s-button>
      <s-button slot="secondary-actions" href="shopify://admin/products">
        View products
      </s-button>

      <s-section>
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

      <s-section slot="aside" heading="Shopify-native plans">
        <s-paragraph>
          Every offer is stored as a Shopify selling plan group. Checkout, payment vaulting, taxes,
          and the resulting subscription contract stay inside Shopify.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
