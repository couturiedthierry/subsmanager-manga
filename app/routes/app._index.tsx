import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { graphqlRequest } from "../lib/graphql.server";
import { DASHBOARD_QUERY } from "../lib/shopify-queries";
import { badgeTone, formatDate, formatMoney } from "../lib/format";
import { ensureShop } from "../models/shop.server";
import { hasSubscriptionAccess } from "../lib/access.server";
import { SubscriptionAccessBanner } from "../components/subscription-access-banner";
import { getSealClient } from "../models/seal-connection.server";
import { sealAmount } from "../lib/seal-helpers";

type DashboardData = {
  shop: { name: string; currencyCode: string };
  sellingPlanGroups: {
    nodes: Array<{
      id: string;
      name: string;
      merchantCode: string;
      productsCount: { count: number };
      sellingPlans: { nodes: Array<{ id: string; name: string }> };
    }>;
  };
  subscriptionContracts?: {
    nodes: Array<{
      id: string;
      status: string;
      currencyCode: string;
      nextBillingDate: string | null;
      lastPaymentStatus: string | null;
      customer: { id: string; displayName: string } | null;
      lines: {
        nodes: Array<{
          title: string;
          quantity: number;
          lineDiscountedPrice: { amount: string; currencyCode: string };
        }>;
      };
    }>;
  };
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const subscriptionAccess = hasSubscriptionAccess(session.scope);
  const apiData = await graphqlRequest<DashboardData>(admin, DASHBOARD_QUERY, {
    withContracts: subscriptionAccess,
  });
  const shop = await ensureShop(session.shop, apiData.shop.name);
  const contracts = apiData.subscriptionContracts?.nodes || [];
  const active = contracts.filter((contract) => contract.status === "ACTIVE");
  const due = active.filter(
    (contract) => contract.nextBillingDate && new Date(contract.nextBillingDate).getTime() <= Date.now(),
  );
  const attention = contracts.filter((contract) =>
    ["FAILED", "PAUSED"].includes(contract.status),
  );
  const projectedRevenue = active.reduce(
    (sum, contract) =>
      sum +
      contract.lines.nodes.reduce(
        (lineSum, line) =>
          lineSum + Number(line.lineDiscountedPrice.amount) * line.quantity,
        0,
      ),
    0,
  );

  // While Shopify's approval is pending, show Seal's numbers if the store connected Seal.
  let seal: { connected: boolean; active: number; more: boolean; revenue: number } = {
    connected: false,
    active: 0,
    more: false,
    revenue: 0,
  };
  if (!subscriptionAccess) {
    const client = await getSealClient(session.shop);
    if (client) {
      seal = { ...seal, connected: true };
      try {
        const page = await client.listSubscriptions({ status: "ACTIVE" });
        seal = {
          connected: true,
          active: page.subscriptions.length,
          more: Boolean(page.next_cursor),
          revenue: page.subscriptions.reduce((sum, subscription) => sum + sealAmount(subscription), 0),
        };
      } catch {
        // The dashboard still loads; the Subscriptions page shows Seal's error message.
      }
    }
  }

  return {
    now: Date.now(),
    subscriptionAccess,
    seal,
    shop,
    store: apiData.shop,
    plans: apiData.sellingPlanGroups.nodes,
    contracts,
    metrics: {
      active: active.length,
      due: due.length,
      attention: attention.length,
      projectedRevenue,
      planCount: apiData.sellingPlanGroups.nodes.length,
    },
  };
};

export default function Dashboard() {
  const { now, subscriptionAccess, seal, shop, store, plans, contracts, metrics } = useLoaderData<typeof loader>();
  const setupSteps = [
    { label: "Create a subscription plan", done: plans.length > 0, href: "/app/plans/new" },
    { label: "Add the storefront app block", done: shop.onboardingComplete, href: "/app/settings" },
    { label: "Review dunning settings", done: shop.onboardingComplete, href: "/app/settings" },
  ];
  const completed = setupSteps.filter((step) => step.done).length;

  return (
    <s-page heading={`Welcome to SubsManager Manga, ${store.name}`}>
      <s-button
        slot="primary-action"
        variant="primary"
        href="/app/plans/new"
      >
        Create plan
      </s-button>
      {!subscriptionAccess && !seal.connected ? <SubscriptionAccessBanner /> : null}
      {seal.connected ? (
        <s-banner tone="info" heading="Connected to Seal Subscriptions">
          {seal.active}{seal.more ? "+" : ""} active subscription{seal.active === 1 && !seal.more ? "" : "s"} billed by Seal
          {seal.revenue > 0 ? ` (${formatMoney(seal.revenue, store.currencyCode)} per cycle)` : ""}. Manage them on the
          Subscriptions page.
        </s-banner>
      ) : null}

      {completed < setupSteps.length && (
        <s-banner heading="Finish setting up subscriptions" tone="info">
          Complete {completed} of {setupSteps.length} steps to start selling subscriptions.
        </s-banner>
      )}

      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(190px, 1fr))" gap="base">
        <s-section heading="Active subscriptions">
          <s-stack direction="block" gap="small">
            <s-text type="strong">{metrics.active}</s-text>
            <s-paragraph color="subdued">Live customer contracts</s-paragraph>
          </s-stack>
        </s-section>
        <s-section heading="Next-cycle revenue">
          <s-stack direction="block" gap="small">
            <s-text type="strong">
              {formatMoney(metrics.projectedRevenue, store.currencyCode)}
            </s-text>
            <s-paragraph color="subdued">Projected from active contracts</s-paragraph>
          </s-stack>
        </s-section>
        <s-section heading="Selling plans">
          <s-stack direction="block" gap="small">
            <s-text type="strong">{metrics.planCount}</s-text>
            <s-paragraph color="subdued">Offers available in Shopify</s-paragraph>
          </s-stack>
        </s-section>
        <s-section heading="Due for renewal">
          <s-stack direction="block" gap="small">
            <s-text type="strong">{metrics.due}</s-text>
            {metrics.due > 0 ? <s-link href="/app/subscriptions?status=DUE">Review due renewals</s-link> : null}
            <s-paragraph color="subdued">Renewals due and not yet charged</s-paragraph>
          </s-stack>
        </s-section>
      </s-grid>

      <s-section heading="Recent subscriptions">
        {contracts.length === 0 ? (
          <s-box padding="large" background="subdued" borderRadius="base">
            <s-stack direction="block" gap="base" alignItems="center">
              <s-icon type="order" size="base" color="subdued"></s-icon>
              <s-heading>No subscriptions yet</s-heading>
              <s-paragraph color="subdued">
                Create a selling plan and add the SubsManager Manga block to your product template.
              </s-paragraph>
              <s-button variant="primary" href="/app/plans/new">
                Create your first plan
              </s-button>
            </s-stack>
          </s-box>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Customer</s-table-header>
              <s-table-header>Product</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Next billing</s-table-header>
              <s-table-header format="currency">Value</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {contracts.slice(0, 8).map((contract) => {
                const firstLine = contract.lines.nodes[0];
                const isDue = contract.status === "ACTIVE" && Boolean(
                  contract.nextBillingDate && new Date(contract.nextBillingDate).getTime() <= now,
                );
                const contractValue = contract.lines.nodes.reduce(
                  (sum, line) => sum + Number(line.lineDiscountedPrice.amount) * line.quantity,
                  0,
                );
                return (
                  <s-table-row key={contract.id}>
                    <s-table-cell>
                      <s-link href={`/app/subscriptions/${contract.id.split("/").at(-1)}`}>
                        {contract.customer?.displayName || "Customer"}
                      </s-link>
                    </s-table-cell>
                    <s-table-cell>{firstLine?.title || "Subscription"}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={isDue ? "warning" : badgeTone(contract.status)}>
                        {isDue ? "DUE — NEEDS APPROVAL" : contract.status}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>{formatDate(contract.nextBillingDate)}</s-table-cell>
                    <s-table-cell>{formatMoney(contractValue, contract.currencyCode)}</s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
        {contracts.length > 0 && (
          <s-box paddingBlockStart="base">
            <s-link href="/app/subscriptions">View all subscriptions</s-link>
          </s-box>
        )}
      </s-section>

      <s-section slot="aside" heading="Setup guide">
        <s-stack direction="block" gap="base">
          <s-paragraph color="subdued">{completed} of {setupSteps.length} complete</s-paragraph>
          {setupSteps.map((step) => (
            <s-clickable key={step.label} href={step.href} padding="small" borderRadius="base">
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-icon type={step.done ? "check-circle" : "circle"} tone={step.done ? "success" : "neutral"}></s-icon>
                <s-text>{step.label}</s-text>
              </s-stack>
            </s-clickable>
          ))}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Store health">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" justifyContent="space-between">
            <s-text>Shopify connection</s-text>
            <s-badge tone="success">Connected</s-badge>
          </s-stack>
          <s-stack direction="inline" justifyContent="space-between">
            <s-text>API version</s-text>
            <s-badge tone="info">2026-07</s-badge>
          </s-stack>
          <s-stack direction="inline" justifyContent="space-between">
            <s-text>Renewals</s-text>
            <s-badge tone="info">Manual approval</s-badge>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
