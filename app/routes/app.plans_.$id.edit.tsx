// Keep /app/plans/:id/edit outside the plans index layout.
import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { graphqlRequest, throwOnUserErrors } from "../lib/graphql.server";
import {
  ADD_SELLING_PLAN_PRODUCTS,
  REMOVE_SELLING_PLAN_PRODUCTS,
  SELLING_PLAN_GROUP_QUERY,
  UPDATE_SELLING_PLAN_GROUP,
} from "../lib/shopify-queries";
import { parsePlanOptions, PLAN_GROUP_OPTION_NAME, sellingPlanInput } from "../lib/plan-input.server";
import type { PlanInterval, PlanOptionRow } from "../lib/plan-options";
import { PlanOptionsEditor } from "../components/plan-options-editor";

type PickedProduct = { id: string; title: string };

type PlanGroup = {
  id: string;
  name: string;
  merchantCode: string;
  products: { nodes: PickedProduct[] };
  sellingPlans: {
    nodes: Array<{
      id: string;
      name: string;
      options: string[];
      billingPolicy?: { interval: string; intervalCount: number };
      pricingPolicies: Array<{
        adjustmentType: string;
        adjustmentValue?: { percentage?: number };
      }>;
    }>;
  };
};

type PlanGroupData = { sellingPlanGroup: PlanGroup | null };

type UpdateResult = {
  sellingPlanGroupUpdate: {
    sellingPlanGroup: { id: string; name: string; merchantCode: string } | null;
    userErrors: Array<{ field?: string[]; message: string }>;
  };
};

type AddProductsResult = {
  sellingPlanGroupAddProducts: {
    sellingPlanGroup: { id: string } | null;
    userErrors: Array<{ field?: string[]; message: string }>;
  };
};

type RemoveProductsResult = {
  sellingPlanGroupRemoveProducts: {
    removedProductIds: string[];
    userErrors: Array<{ field?: string[]; message: string }>;
  };
};

function planId(value: string | undefined) {
  const raw = decodeURIComponent(value || "");
  if (raw.startsWith("gid://shopify/SellingPlanGroup/")) return raw;
  const numeric = raw.replace(/\D/g, "");
  if (!numeric) throw new Response("Selling plan not found", { status: 404 });
  return `gid://shopify/SellingPlanGroup/${numeric}`;
}

async function loadPlanGroup(admin: Parameters<typeof graphqlRequest>[0], id: string) {
  const data = await graphqlRequest<PlanGroupData>(admin, SELLING_PLAN_GROUP_QUERY, { id });
  if (!data.sellingPlanGroup) throw new Response("Selling plan not found", { status: 404 });
  return data.sellingPlanGroup;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  return loadPlanGroup(admin, planId(params.id));
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const id = planId(params.id);
  const current = await loadPlanGroup(admin, id);

  const formData = await request.formData();
  const name = String(formData.get("name") || "").trim();
  const merchantCode = String(formData.get("merchantCode") || "").trim();
  const productIds = String(formData.get("productIds") || "")
    .split(",")
    .map((productId) => productId.trim())
    .filter(Boolean);

  if (!name || !merchantCode) return { error: "Plan and internal names are required" };
  if (!productIds.length) return { error: "Select at least one product" };
  const options = parsePlanOptions(formData.get("planOptions"));
  if ("error" in options) return { error: options.error };

  const existingIds = new Set(current.sellingPlans.nodes.map((plan) => plan.id));
  const keptIds = new Set(options.rows.map((row) => row.id).filter((rowId): rowId is string => Boolean(rowId)));
  const input = {
    name,
    merchantCode,
    options: [PLAN_GROUP_OPTION_NAME],
    position: 1,
    sellingPlansToUpdate: options.rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.id && existingIds.has(row.id))
      .map(({ row, index }) => sellingPlanInput(row, index + 1)),
    sellingPlansToCreate: options.rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => !row.id || !existingIds.has(row.id))
      .map(({ row, index }) => sellingPlanInput({ ...row, id: undefined }, index + 1)),
    sellingPlansToDelete: [...existingIds].filter((planIdValue) => !keptIds.has(planIdValue)),
  };

  try {
    const updated = await graphqlRequest<UpdateResult>(admin, UPDATE_SELLING_PLAN_GROUP, {
      id,
      input,
    });
    throwOnUserErrors(updated.sellingPlanGroupUpdate.userErrors);

    const currentIds = new Set(current.products.nodes.map((product) => product.id));
    const selectedIds = new Set(productIds);
    const productIdsToAdd = productIds.filter((productId) => !currentIds.has(productId));
    const productIdsToRemove = [...currentIds].filter((productId) => !selectedIds.has(productId));

    if (productIdsToAdd.length) {
      const added = await graphqlRequest<AddProductsResult>(admin, ADD_SELLING_PLAN_PRODUCTS, {
        id,
        productIds: productIdsToAdd,
      });
      throwOnUserErrors(added.sellingPlanGroupAddProducts.userErrors);
    }

    if (productIdsToRemove.length) {
      const removed = await graphqlRequest<RemoveProductsResult>(admin, REMOVE_SELLING_PLAN_PRODUCTS, {
        id,
        productIds: productIdsToRemove,
      });
      throwOnUserErrors(removed.sellingPlanGroupRemoveProducts.userErrors);
    }

    return redirect("/app/plans?updated=1");
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to update selling plan" };
  }
};

export default function EditPlan() {
  const group = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const [products, setProducts] = useState<PickedProduct[]>(group.products.nodes);
  const [planOptions, setPlanOptions] = useState<PlanOptionRow[]>(() =>
    group.sellingPlans.nodes.map((plan) => {
      const policy = plan.pricingPolicies[0];
      const isPercentage = !policy || policy.adjustmentType === "PERCENTAGE";
      return {
        key: plan.id,
        id: plan.id,
        intervalCount: plan.billingPolicy?.intervalCount || 1,
        interval: (plan.billingPolicy?.interval || "MONTH") as PlanInterval,
        discount: isPercentage ? policy?.adjustmentValue?.percentage || 0 : null,
      };
    }),
  );
  const isSubmitting = navigation.state === "submitting";
  const formRef = useRef<HTMLFormElement>(null);
  // Page-header buttons render in Shopify's title bar, outside this form, so submit it explicitly.
  const submitForm = () => formRef.current?.requestSubmit();

  useEffect(() => {
    if (actionData?.error) shopify.toast.show(actionData.error, { isError: true });
  }, [actionData, shopify]);

  const pickProducts = async () => {
    try {
      const selection = await shopify.resourcePicker({
        type: "product",
        multiple: true,
        selectionIds: products.map((product) => ({ id: product.id })),
      });
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
      <s-page heading={`Edit ${group.name}`}>
        <s-link slot="breadcrumb-actions" href="/app/plans">Selling plans</s-link>
        <s-button slot="primary-action" variant="primary" loading={isSubmitting} onClick={submitForm}>
          Save changes
        </s-button>
        <s-button slot="secondary-actions" href="/app/plans">Cancel</s-button>

        <input type="hidden" name="productIds" value={products.map((product) => product.id).join(",")} />
        <s-stack direction="block" gap="base">
          {actionData?.error && <s-banner tone="critical">{actionData.error}</s-banner>}

          <s-banner tone="info">
            Changes affect future purchases. Existing subscription contracts keep the terms the
            customer already accepted.
          </s-banner>

          <s-section heading="Offer details">
            <s-stack direction="block" gap="base">
              <s-text-field
                name="name"
                label="Customer-facing plan name"
                defaultValue={group.name}
                required
              ></s-text-field>
              <s-text-field
                name="merchantCode"
                label="Internal name"
                defaultValue={group.merchantCode}
                required
              ></s-text-field>
            </s-stack>
          </s-section>

          <s-section heading="Delivery frequencies and discounts">
            <PlanOptionsEditor rows={planOptions} onChange={setPlanOptions} />
          </s-section>

          <s-section heading="Products">
            <s-stack direction="block" gap="base">
              <s-button type="button" onClick={pickProducts}>Change products</s-button>
              {products.map((product) => (
                <s-box key={product.id} padding="small" background="subdued" borderRadius="base">
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-icon type="product"></s-icon>
                    <s-text>{product.title}</s-text>
                  </s-stack>
                </s-box>
              ))}
              {!products.length && <s-banner tone="warning">Select at least one product.</s-banner>}
            </s-stack>
          </s-section>

          <s-stack direction="inline" gap="base" justifyContent="end">
            <s-button href="/app/plans">Cancel</s-button>
            <s-button variant="primary" loading={isSubmitting} onClick={submitForm}>
              Save changes
            </s-button>
          </s-stack>
        </s-stack>

        <s-section slot="aside" heading="Editing behavior">
          <s-paragraph>
            Product assignments and checkout terms update immediately after Shopify accepts the change.
          </s-paragraph>
        </s-section>
      </s-page>
    </Form>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
