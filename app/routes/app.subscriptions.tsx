import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useRef } from "react";
import { Form, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { graphqlRequest } from "../lib/graphql.server";
import { SUBSCRIPTIONS_QUERY } from "../lib/shopify-queries";
import { badgeTone, formatDate, formatMoney } from "../lib/format";
import { hasSubscriptionAccess } from "../lib/access.server";
import { SubscriptionAccessBanner } from "../components/subscription-access-banner";
import { getSealClient } from "../models/seal-connection.server";
import { SealApiError } from "../lib/seal.server";
import { sealAmount, sealCustomerName, sealNextBillingDate, type SealStatusFilter } from "../lib/seal-helpers";

type SubscriptionsData = {
  subscriptionContracts: {
    nodes: Array<{
      id: string;
      status: string;
      currencyCode: string;
      nextBillingDate: string | null;
      lastPaymentStatus: string | null;
      customer: { id: string; displayName: string } | null;
      originOrder: { id: string; name: string } | null;
      lines: {
        nodes: Array<{
          title: string;
          quantity: number;
          lineDiscountedPrice: { amount: string; currencyCode: string };
        }>;
      };
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

const PAGE_SIZE = 50;

/** One row of the list, whichever system the subscription comes from. */
type Row = {
  key: string;
  href: string;
  customer: string;
  title: string;
  subtitle: string;
  status: string;
  nextBillingDate: string | null;
  amount: number;
  currencyCode: string;
  isDue: boolean;
};

const SEAL_STATUSES: SealStatusFilter[] = ["", "ACTIVE", "PAUSED", "CANCELLED"];

async function loadSealRows(shopDomain: string, search: string, status: string, cursor: string | null) {
  const client = await getSealClient(shopDomain);
  if (!client) return null;
  const sealStatus = (SEAL_STATUSES as string[]).includes(status) ? (status as SealStatusFilter) : "";
  try {
    const page = await client.listSubscriptions({ query: search, cursor, status: sealStatus });
    const rows: Row[] = page.subscriptions.map((subscription) => ({
      key: `seal-${subscription.id}`,
      href: `/app/subscriptions/seal/${subscription.id}`,
      customer: sealCustomerName(subscription),
      title: subscription.items?.find((item) => !item.is_one_time_item)?.title || subscription.items?.[0]?.title || "Subscription",
      subtitle: subscription.delivery_interval ? `Every ${subscription.delivery_interval}` : subscription.email || "—",
      status: String(subscription.status || "").toUpperCase(),
      nextBillingDate: sealNextBillingDate(subscription),
      amount: sealAmount(subscription),
      currencyCode: subscription.currency || "USD",
      isDue: false,
    }));
    return { rows, nextCursor: page.next_cursor, error: null as string | null };
  } catch (error) {
    return {
      rows: [] as Row[],
      nextCursor: null,
      error: error instanceof SealApiError ? error.message : "Could not load subscriptions from Seal",
    };
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const search = url.searchParams.get("q")?.trim() || "";
  const status = url.searchParams.get("status")?.trim().toUpperCase() || "";
  const after = url.searchParams.get("after") || null;
  if (!hasSubscriptionAccess(session.scope)) {
    // While Shopify's approval is pending, a store that runs Seal can manage Seal's subscriptions here.
    const seal = await loadSealRows(session.shop, search, status, after);
    return {
      source: seal ? ("seal" as const) : ("none" as const),
      sourceError: seal?.error || null,
      rows: seal?.rows || [],
      nextCursor: seal?.nextCursor || null,
      search,
      status,
      after,
    };
  }
  const now = Date.now();
  // Shopify only filters contracts by status (no text search or billing-date filter),
  // so search and "due" filtering happen here over up to 250 contracts per request.
  const shopifyStatus = status === "DUE" ? "ACTIVE" : status;
  const clientFilter = Boolean(search) || status === "DUE";
  const data = await graphqlRequest<SubscriptionsData>(admin, SUBSCRIPTIONS_QUERY, {
    first: clientFilter ? 250 : PAGE_SIZE,
    after,
    query: shopifyStatus ? `status:${shopifyStatus}` : null,
  });
  const needle = search.toLowerCase();
  const nodes = data.subscriptionContracts.nodes.filter((contract) => {
    if (status === "DUE" && !(contract.nextBillingDate && new Date(contract.nextBillingDate).getTime() <= now)) {
      return false;
    }
    if (!needle) return true;
    const haystack = [
      contract.customer?.displayName,
      contract.originOrder?.name,
      contract.id.split("/").at(-1),
      ...contract.lines.nodes.map((line) => line.title),
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(needle);
  });
  const rows: Row[] = nodes.map((contract) => ({
    key: contract.id,
    href: `/app/subscriptions/${contract.id.split("/").at(-1)}`,
    customer: contract.customer?.displayName || "Customer",
    title: contract.lines.nodes[0]?.title || "Subscription",
    subtitle: contract.originOrder?.name || "—",
    status: contract.status,
    nextBillingDate: contract.nextBillingDate,
    amount: contract.lines.nodes.reduce(
      (sum, line) => sum + Number(line.lineDiscountedPrice.amount) * line.quantity,
      0,
    ),
    currencyCode: contract.currencyCode,
    isDue: contract.status === "ACTIVE" && Boolean(
      contract.nextBillingDate && new Date(contract.nextBillingDate).getTime() <= now,
    ),
  }));
  return {
    source: "shopify" as const,
    sourceError: null as string | null,
    rows,
    nextCursor: data.subscriptionContracts.pageInfo.hasNextPage ? data.subscriptionContracts.pageInfo.endCursor : null,
    search,
    status,
    after,
  };
};

export default function Subscriptions() {
  const { source, sourceError, rows, nextCursor, search, status, after } = useLoaderData<typeof loader>();
  const filterRef = useRef<HTMLFormElement>(null);
  const isSeal = source === "seal";
  const pageLink = (cursor: string | null) => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (status) params.set("status", status);
    if (cursor) params.set("after", cursor);
    const query = params.toString();
    return `/app/subscriptions${query ? `?${query}` : ""}`;
  };
  return (
    <s-page heading="Subscriptions">
      {isSeal ? (
        <s-button slot="primary-action" variant="primary" href="/app/plans">View plans</s-button>
      ) : (
        <s-button slot="primary-action" variant="primary" href="/app/plans/new">Create plan</s-button>
      )}
      {source === "none" ? <SubscriptionAccessBanner /> : null}
      {isSeal ? (
        <s-banner tone="info" heading="Showing subscriptions from Seal">
          These subscriptions are billed by Seal Subscriptions. Changes you make here are sent to Seal.
        </s-banner>
      ) : null}
      {sourceError ? <s-banner tone="critical">{sourceError}</s-banner> : null}

      <s-section>
        <Form method="get" ref={filterRef}>
          <s-grid gridTemplateColumns="2fr 1fr auto" gap="base" alignItems="end">
            <s-search-field
              name="q"
              label="Search subscriptions"
              placeholder={isSeal ? "Customer name or email" : "Customer name, order number, or product"}
              defaultValue={search}
            ></s-search-field>
            <s-select name="status" label="Status" value={status}>
              <s-option value="">All statuses</s-option>
              {isSeal ? null : <s-option value="DUE">Due — waiting for approval</s-option>}
              <s-option value="ACTIVE">Active</s-option>
              <s-option value="PAUSED">Paused</s-option>
              {isSeal ? null : <s-option value="FAILED">Failed</s-option>}
              <s-option value="CANCELLED">Cancelled</s-option>
              {isSeal ? null : <s-option value="EXPIRED">Expired</s-option>}
            </s-select>
            <s-button onClick={() => filterRef.current?.requestSubmit()}>Filter</s-button>
          </s-grid>
        </Form>
      </s-section>

      <s-section heading={`${rows.length} subscription${rows.length === 1 ? "" : "s"}${after ? " (more results)" : ""}`}>
        {rows.length === 0 ? (
          <s-box padding="large" background="subdued" borderRadius="base">
            <s-stack direction="block" gap="base" alignItems="center">
              <s-heading>No subscriptions found</s-heading>
              <s-paragraph color="subdued">
                {isSeal
                  ? "When a customer subscribes on your store, the subscription appears here."
                  : "Try another filter or create a selling plan for your products."}
              </s-paragraph>
            </s-stack>
          </s-box>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Customer</s-table-header>
              <s-table-header>Subscription</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Next charge</s-table-header>
              <s-table-header format="currency">Amount</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rows.map((row) => (
                <s-table-row key={row.key}>
                  <s-table-cell>
                    <s-link href={row.href}>{row.customer}</s-link>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="block" gap="small">
                      <s-text>{row.title}</s-text>
                      <s-text color="subdued">{row.subtitle}</s-text>
                    </s-stack>
                  </s-table-cell>
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
        {after || nextCursor ? (
          <s-box paddingBlockStart="base">
            <s-stack direction="inline" gap="base">
              {after ? <s-button href={pageLink(null)}>First page</s-button> : null}
              {nextCursor ? <s-button href={pageLink(nextCursor)}>Next page</s-button> : null}
            </s-stack>
          </s-box>
        ) : null}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
