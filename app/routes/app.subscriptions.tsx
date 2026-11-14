import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useRef } from "react";
import { Form, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { graphqlRequest } from "../lib/graphql.server";
import { SUBSCRIPTIONS_QUERY } from "../lib/shopify-queries";
import { badgeTone, formatDate, formatMoney } from "../lib/format";

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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const search = url.searchParams.get("q")?.trim() || "";
  const status = url.searchParams.get("status")?.trim().toUpperCase() || "";
  const after = url.searchParams.get("after") || null;
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
  return {
    nodes,
    pageInfo: data.subscriptionContracts.pageInfo,
    search,
    status,
    after,
    now,
  };
};

export default function Subscriptions() {
  const { nodes: contracts, pageInfo, search, status, after, now } = useLoaderData<typeof loader>();
  const filterRef = useRef<HTMLFormElement>(null);
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
      <s-button
        slot="primary-action"
        variant="primary"
        href="/app/plans/new"
      >
        Create plan
      </s-button>

      <s-section>
        <Form method="get" ref={filterRef}>
          <s-grid gridTemplateColumns="2fr 1fr auto" gap="base" alignItems="end">
            <s-search-field
              name="q"
              label="Search subscriptions"
              placeholder="Customer name, order number, or product"
              defaultValue={search}
            ></s-search-field>
            <s-select name="status" label="Status" value={status}>
              <s-option value="">All statuses</s-option>
              <s-option value="DUE">Due — waiting for approval</s-option>
              <s-option value="ACTIVE">Active</s-option>
              <s-option value="PAUSED">Paused</s-option>
              <s-option value="FAILED">Failed</s-option>
              <s-option value="CANCELLED">Cancelled</s-option>
              <s-option value="EXPIRED">Expired</s-option>
            </s-select>
            <s-button onClick={() => filterRef.current?.requestSubmit()}>Filter</s-button>
          </s-grid>
        </Form>
      </s-section>

      <s-section heading={`${contracts.length} subscription${contracts.length === 1 ? "" : "s"}${after ? " (more results)" : ""}`}>
        {contracts.length === 0 ? (
          <s-box padding="large" background="subdued" borderRadius="base">
            <s-stack direction="block" gap="base" alignItems="center">
              <s-heading>No subscriptions found</s-heading>
              <s-paragraph color="subdued">
                Try another filter or create a selling plan for your products.
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
              {contracts.map((contract) => {
                const amount = contract.lines.nodes.reduce(
                  (sum, line) => sum + Number(line.lineDiscountedPrice.amount) * line.quantity,
                  0,
                );
                const isDue = contract.status === "ACTIVE" && Boolean(
                  contract.nextBillingDate && new Date(contract.nextBillingDate).getTime() <= now,
                );
                return (
                  <s-table-row key={contract.id}>
                    <s-table-cell>
                      <s-link href={`/app/subscriptions/${contract.id.split("/").at(-1)}`}>
                        {contract.customer?.displayName || "Customer"}
                      </s-link>
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="block" gap="small">
                        <s-text>{contract.lines.nodes[0]?.title || "Subscription"}</s-text>
                        <s-text color="subdued">{contract.originOrder?.name || "—"}</s-text>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={isDue ? "warning" : badgeTone(contract.status)}>
                        {isDue ? "DUE — NEEDS APPROVAL" : contract.status}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>{formatDate(contract.nextBillingDate)}</s-table-cell>
                    <s-table-cell>{formatMoney(amount, contract.currencyCode)}</s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
        {after || pageInfo.hasNextPage ? (
          <s-box paddingBlockStart="base">
            <s-stack direction="inline" gap="base">
              {after ? <s-button href={pageLink(null)}>First page</s-button> : null}
              {pageInfo.hasNextPage && pageInfo.endCursor ? (
                <s-button href={pageLink(pageInfo.endCursor)}>Next page</s-button>
              ) : null}
            </s-stack>
          </s-box>
        ) : null}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
