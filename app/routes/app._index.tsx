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
import { sealAmount, sealCustomerName, sealNextBillingDate } from "../lib/seal-helpers";
import { dueSealSubscriptionIds } from "../models/seal-renewals.server";
import prisma from "../db.server";

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

type RecentRow = {
  key: string;
  href: string;
  customer: string;
  product: string;
  status: string;
  isDue: boolean;
  nextBillingDate: string | null;
  amount: number;
  currencyCode: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const subscriptionAccess = hasSubscriptionAccess(session.scope);
  const apiData = await graphqlRequest<DashboardData>(admin, DASHBOARD_QUERY, {
    withContracts: subscriptionAccess,
  });
  const shop = await ensureShop(session.shop, apiData.shop.name);
  const now = Date.now();

  if (subscriptionAccess) {
    // Shopify-native subscriptions (only used if this app is ever granted the subscription permissions).
    const contracts = apiData.subscriptionContracts?.nodes || [];
    const active = contracts.filter((contract) => contract.status === "ACTIVE");
    const total = (contract: (typeof contracts)[number]) =>
      contract.lines.nodes.reduce((sum, line) => sum + Number(line.lineDiscountedPrice.amount) * line.quantity, 0);
    const recent: RecentRow[] = contracts.slice(0, 8).map((contract) => ({
      key: contract.id,
      href: `/app/subscriptions/${contract.id.split("/").at(-1)}`,
      customer: contract.customer?.displayName || "Customer",
      product: contract.lines.nodes[0]?.title || "Subscription",
      status: contract.status,
      isDue: contract.status === "ACTIVE" && Boolean(contract.nextBillingDate && new Date(contract.nextBillingDate).getTime() <= now),
      nextBillingDate: contract.nextBillingDate,
      amount: total(contract),
      currencyCode: contract.currencyCode,
    }));
    return {
      store: apiData.shop,
      mode: "shopify" as const,
      sealConnected: false,
      manual: true,
      recent,
      metrics: {
        active: String(active.length),
        revenue: active.reduce((sum, contract) => sum + total(contract), 0),
        plans: apiData.sellingPlanGroups.nodes.length,
        due: recent.filter((row) => row.isDue).length,
      },
      setupSteps: [
        { label: "Create a subscription plan", done: apiData.sellingPlanGroups.nodes.length > 0, href: "/app/plans/new" },
        { label: "Add the product page widget", done: shop.onboardingComplete, href: "/app/settings" },
      ],
    };
  }

  // Seal: subscriptions are billed by the Seal Subscriptions app and managed here through its API.
  const client = await getSealClient(session.shop);
  let recent: RecentRow[] = [];
  let active = "0";
  let revenue = 0;
  let plans = 0;
  let due = 0;
  let loadError: string | null = null;
  if (client) {
    try {
      const [page, rules, dueIds] = await Promise.all([
        client.listSubscriptions({ status: "ACTIVE" }),
        client.listRules(1),
        dueSealSubscriptionIds(session.shop),
      ]);
      const dueSet = new Set(dueIds);
      const heldNext = await prisma.sealHeldAttempt.groupBy({
        by: ["subscriptionId"],
        where: { shopDomain: session.shop, state: "HELD", subscriptionId: { in: page.subscriptions.map((sub) => String(sub.id)) } },
        _min: { billingDate: true },
      });
      const heldMap = new Map(heldNext.map((row) => [row.subscriptionId, row._min.billingDate?.toISOString() || null]));
      active = `${page.subscriptions.length}${page.next_cursor ? "+" : ""}`;
      revenue = page.subscriptions.reduce((sum, subscription) => sum + sealAmount(subscription), 0);
      plans = rules.subscription_rules.length;
      due = dueIds.length;
      recent = page.subscriptions.slice(0, 8).map((subscription) => ({
        key: `seal-${subscription.id}`,
        href: `/app/subscriptions/seal/${subscription.id}`,
        customer: sealCustomerName(subscription),
        product: subscription.items?.[0]?.title || "Subscription",
        status: String(subscription.status || "").toUpperCase(),
        isDue: dueSet.has(String(subscription.id)),
        nextBillingDate:
          [sealNextBillingDate(subscription), heldMap.get(String(subscription.id)) || null]
            .filter((value): value is string => Boolean(value))
            .sort()[0] || null,
        amount: sealAmount(subscription),
        currencyCode: subscription.currency || apiData.shop.currencyCode,
      }));
    } catch (error) {
      loadError = error instanceof Error ? error.message : "Could not load data from Seal";
    }
  }
  return {
    store: apiData.shop,
    mode: "seal" as const,
    sealConnected: Boolean(client),
    manual: shop.sealManualRenewals,
    loadError,
    recent,
    metrics: { active, revenue, plans, due },
    setupSteps: [
      { label: "Connect Seal Subscriptions", done: Boolean(client), href: "/app/seal" },
      { label: "Create a plan in Seal", done: plans > 0, href: "/app/plans" },
      { label: "Add the product page widget", done: shop.onboardingComplete, href: "/app/settings" },
    ],
  };
};

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const { store, mode, sealConnected, manual, recent, metrics, setupSteps } = data;
  const loadError = "loadError" in data ? data.loadError : null;
  const completed = setupSteps.filter((step) => step.done).length;

  return (
    <s-page heading={`Welcome to SubsManager Manga, ${store.name}`}>
      <s-button slot="primary-action" variant="primary" href={mode === "seal" ? "/app/subscriptions" : "/app/plans/new"}>
        {mode === "seal" ? "View subscriptions" : "Create plan"}
      </s-button>
      {mode === "seal" && !sealConnected ? <SubscriptionAccessBanner /> : null}
      {loadError ? <s-banner tone="critical">{loadError}</s-banner> : null}
      {metrics.due > 0 ? (
        <s-banner tone="warning" heading={`${metrics.due} renewal${metrics.due === 1 ? "" : "s"} waiting for approval`}>
          <s-link href="/app/subscriptions?status=DUE">Review due renewals</s-link>
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
            <s-paragraph color="subdued">Live customer subscriptions</s-paragraph>
          </s-stack>
        </s-section>
        <s-section heading="Next-cycle revenue">
          <s-stack direction="block" gap="small">
            <s-text type="strong">{formatMoney(metrics.revenue, store.currencyCode)}</s-text>
            <s-paragraph color="subdued">Projected from active subscriptions</s-paragraph>
          </s-stack>
        </s-section>
        <s-section heading="Plans">
          <s-stack direction="block" gap="small">
            <s-text type="strong">{metrics.plans}</s-text>
            <s-paragraph color="subdued">{mode === "seal" ? "Subscription plans in Seal" : "Offers available in Shopify"}</s-paragraph>
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
        {recent.length === 0 ? (
          <s-box padding="large" background="subdued" borderRadius="base">
            <s-stack direction="block" gap="base" alignItems="center">
              <s-icon type="order" size="base" color="subdued"></s-icon>
              <s-heading>No subscriptions yet</s-heading>
              <s-paragraph color="subdued">
                {mode === "seal"
                  ? "Create a plan in Seal and add the SubsManager Manga widget to your product page."
                  : "Create a selling plan and add the SubsManager Manga block to your product template."}
              </s-paragraph>
              <s-button variant="primary" href={mode === "seal" ? "/app/plans" : "/app/plans/new"}>
                {mode === "seal" ? "View plans" : "Create your first plan"}
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
              {recent.map((row) => (
                <s-table-row key={row.key}>
                  <s-table-cell>
                    <s-link href={row.href}>{row.customer}</s-link>
                  </s-table-cell>
                  <s-table-cell>{row.product}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={row.isDue ? "warning" : badgeTone(row.status)}>
                      {row.isDue ? "DUE — NEEDS APPROVAL" : row.status}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{formatDate(row.nextBillingDate)}</s-table-cell>
                  <s-table-cell>{formatMoney(row.amount, row.currencyCode)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
        {recent.length > 0 && (
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
          {mode === "seal" ? (
            <s-stack direction="inline" justifyContent="space-between">
              <s-text>Seal Subscriptions</s-text>
              <s-badge tone={sealConnected ? "success" : "warning"}>{sealConnected ? "Connected" : "Not connected"}</s-badge>
            </s-stack>
          ) : null}
          <s-stack direction="inline" justifyContent="space-between">
            <s-text>Renewals</s-text>
            <s-badge tone="info">{manual ? "Manual approval" : "Charged by Seal"}</s-badge>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
