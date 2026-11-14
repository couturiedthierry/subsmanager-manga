import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { shopAnalytics } from "../models/shop.server";
import { badgeTone, formatDate, formatMoney } from "../lib/format";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return shopAnalytics(session.shop);
};

export default function Analytics() {
  const data = useLoaderData<typeof loader>();
  const attempts = data.recovered + data.failed;
  const successRate = attempts ? Math.round((data.recovered / attempts) * 100) : 100;

  return (
    <s-page heading="Analytics">
      <s-button slot="primary-action" href="/app/subscriptions">
        View subscriptions
      </s-button>

      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(190px, 1fr))" gap="base">
        <s-section heading="Renewal revenue">
          <s-text type="strong">{formatMoney(data.revenue, data.currencyCode)}</s-text>
          <s-paragraph color="subdued">Renewal charges confirmed by Shopify</s-paragraph>
        </s-section>
        <s-section heading="Active contracts">
          <s-text type="strong">{data.activeContracts}</s-text>
          <s-paragraph color="subdued">Currently active subscriptions</s-paragraph>
        </s-section>
        <s-section heading="Payment success">
          <s-text type="strong">{successRate}%</s-text>
          <s-paragraph color="subdued">Across processed billing attempts</s-paragraph>
        </s-section>
        <s-section heading="At risk">
          <s-text type="strong">{data.failedContracts}</s-text>
          <s-paragraph color="subdued">Contracts currently in failed state</s-paragraph>
        </s-section>
      </s-grid>

      <s-section heading="Recent billing attempts">
        {data.attempts.length === 0 ? (
          <s-box padding="large" background="subdued" borderRadius="base">
            <s-paragraph color="subdued">
              Charge results appear here after the first renewal is charged.
            </s-paragraph>
          </s-box>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Attempt</s-table-header>
              <s-table-header>Date</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Error</s-table-header>
              <s-table-header format="currency">Amount</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.attempts.map((attempt) => (
                <s-table-row key={attempt.id}>
                  <s-table-cell>{attempt.shopifyId?.split("/").at(-1) || attempt.id}</s-table-cell>
                  <s-table-cell>{formatDate(attempt.attemptedAt)}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={badgeTone(attempt.status)}>{attempt.status}</s-badge>
                  </s-table-cell>
                  <s-table-cell>{attempt.errorCode || "—"}</s-table-cell>
                  <s-table-cell>
                    {attempt.amount ? formatMoney(attempt.amount, attempt.currencyCode || data.currencyCode) : "—"}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="How this is calculated">
        <s-paragraph>
          Revenue counts only renewal charges that Shopify confirmed as paid, using the order total
          Shopify reports. Contract counts update automatically from Shopify.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
