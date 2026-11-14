// Keep /app/plans/new outside the plans index layout.
import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { graphqlRequest, throwOnUserErrors } from "../lib/graphql.server";
import { CREATE_SELLING_PLAN_GROUP } from "../lib/shopify-queries";
import { parsePlanOptions, PLAN_GROUP_OPTION_NAME, sellingPlanInput } from "../lib/plan-input.server";
import type { PlanOptionRow } from "../lib/plan-options";
import { PlanOptionsEditor } from "../components/plan-options-editor";

type CreateResult = {
  sellingPlanGroupCreate: {
    sellingPlanGroup: { id: string; name: string; merchantCode: string } | null;
    userErrors: Array<{ field?: string[]; message: string }>;
  };
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const name = String(formData.get("name") || "").trim();
  const merchantCode = String(formData.get("merchantCode") || "").trim();
  const productIds = String(formData.get("productIds") || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (!name || !merchantCode) return { error: "Plan and internal names are required" };
  if (!productIds.length) return { error: "Select at least one product" };
  const options = parsePlanOptions(formData.get("planOptions"));
  if ("error" in options) return { error: options.error };

  const input = {
    name,
    merchantCode,
    options: [PLAN_GROUP_OPTION_NAME],
    position: 1,
    sellingPlansToCreate: options.rows.map((row, index) => sellingPlanInput({ ...row, id: undefined }, index + 1)),
  };

  try {
    const data = await graphqlRequest<CreateResult>(admin, CREATE_SELLING_PLAN_GROUP, {
      input,
      resources: { productIds },
    });
    throwOnUserErrors(data.sellingPlanGroupCreate.userErrors);
    return redirect("/app/plans?created=1");
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to create selling plan" };
  }
};

type PickedProduct = { id: string; title: string };

export default function NewPlan() {
  const shopify = useAppBridge();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [products, setProducts] = useState<PickedProduct[]>([]);
  const [planOptions, setPlanOptions] = useState<PlanOptionRow[]>([
    { key: "a", intervalCount: 30, interval: "DAY", discount: 20 },
    { key: "b", intervalCount: 45, interval: "DAY", discount: 15 },
    { key: "c", intervalCount: 60, interval: "DAY", discount: 10 },
  ]);
  const isSubmitting = navigation.state === "submitting";
  const formRef = useRef<HTMLFormElement>(null);
  // Page-header buttons render in Shopify's title bar, outside this form, so submit it explicitly.
  const submitForm = () => formRef.current?.requestSubmit();

  useEffect(() => {
    if (actionData?.error) shopify.toast.show(actionData.error, { isError: true });
  }, [actionData, shopify]);

  const pickProducts = async () => {
    try {
      const selection = await shopify.resourcePicker({ type: "product", multiple: true });
      if (selection) {
        setProducts(selection.map((product) => ({ id: product.id, title: product.title })));
      }
    } catch (error) {
      shopify.toast.show(
        error instanceof Error ? error.message : "Unable to open the product picker",
        { isError: true },
      );
    }
  };

  return (
    <Form method="post" ref={formRef}>
      <s-page heading="Create subscription plan">
        <s-link slot="breadcrumb-actions" href="/app/plans">Selling plans</s-link>
        <s-button
          slot="primary-action"
          variant="primary"
          loading={isSubmitting}
          onClick={submitForm}
        >
          Create plan
        </s-button>
        <s-button slot="secondary-actions" href="/app/plans">Cancel</s-button>

        <input type="hidden" name="productIds" value={products.map((product) => product.id).join(",")} />
        <s-stack direction="block" gap="base">
          {actionData?.error && <s-banner tone="critical">{actionData.error}</s-banner>}

          <s-section heading="Offer details">
            <s-stack direction="block" gap="base">
              <s-text-field
                name="name"
                label="Customer-facing plan name"
                placeholder="Subscribe & save"
                details="Shown on product pages, cart, checkout, and customer accounts."
                required
              ></s-text-field>
              <s-text-field
                name="merchantCode"
                label="Internal name"
                placeholder="Monthly essentials"
                details="Only staff can see this name."
                required
              ></s-text-field>
            </s-stack>
          </s-section>

          <s-section heading="Delivery frequencies and discounts">
            <PlanOptionsEditor rows={planOptions} onChange={setPlanOptions} />
          </s-section>

          <s-section heading="Products">
            <s-stack direction="block" gap="base">
              <s-button type="button" onClick={pickProducts}>
                {products.length ? "Change products" : "Select products"}
              </s-button>
              {products.length ? (
                <s-stack direction="block" gap="small">
                  {products.map((product) => (
                    <s-box key={product.id} padding="small" background="subdued" borderRadius="base">
                      <s-stack direction="inline" gap="small" alignItems="center">
                        <s-icon type="product"></s-icon>
                        <s-text>{product.title}</s-text>
                      </s-stack>
                    </s-box>
                  ))}
                </s-stack>
              ) : (
                <s-paragraph color="subdued">No products selected.</s-paragraph>
              )}
            </s-stack>
          </s-section>

          <s-stack direction="inline" gap="base" justifyContent="end">
            <s-button href="/app/plans">Cancel</s-button>
            <s-button variant="primary" loading={isSubmitting} onClick={submitForm}>
              Create plan
            </s-button>
          </s-stack>
        </s-stack>

        <s-section slot="aside" heading="What Shopify handles">
          <s-unordered-list>
            <s-list-item>Checkout consent and payment method vaulting</s-list-item>
            <s-list-item>Subscription contract creation</s-list-item>
            <s-list-item>Tax, discount, and shipping calculations</s-list-item>
          </s-unordered-list>
        </s-section>
      </s-page>
    </Form>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
