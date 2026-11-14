import type { LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { EmptyState, MetricCard, PageHeader, Pagination, Panel, StatusBadge, styles } from "../components/control-ui";
import { requireControlUser } from "../lib/control-auth.server";
import { formatDate, formatMoney } from "../lib/format";
import { controlBilling } from "../models/control.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireControlUser(request);
  const url = new URL(request.url);
  const data = await controlBilling({
    status: url.searchParams.get("status") || undefined,
    shopId: url.searchParams.get("shopId") || undefined,
    page: Number(url.searchParams.get("page") || 1),
  });
  const successful = data.attempts.filter((attempt) => attempt.status === "SUCCESS");
  const failed = data.attempts.filter((attempt) => attempt.status === "FAILURE");
  return {
    ...data,
    filters: {
      status: url.searchParams.get("status") || "",
      shopId: url.searchParams.get("shopId") || "",
    },
    visibleRevenue: successful.reduce((sum, attempt) => sum + Number(attempt.amount || 0), 0),
    visibleSuccessRate: data.attempts.length
      ? Math.round((successful.length / data.attempts.length) * 100)
      : 100,
    visibleFailures: failed.length,
  };
};

export default function ControlBilling() {
  const data = useLoaderData<typeof loader>();
  const currency = data.attempts.find((attempt) => attempt.currencyCode)?.currencyCode || "USD";
  const buildHref = (page: number) => {
    const params = new URLSearchParams(data.filters);
    params.set("page", String(page));
    return `/control/billing?${params}`;
  };

  return (
    <>
      <PageHeader
        eyebrow="Payment operations"
        title="Billing attempts"
        description="Monitor Shopify subscription charges across every connected store. Payment credentials always remain vaulted by Shopify."
      />

      <div className={styles.metrics}>
        <MetricCard label="Matching attempts" value={data.total} detail="Across the current filters" />
        <MetricCard label="Visible revenue" value={formatMoney(data.visibleRevenue, currency)} detail="Successful attempts on this page" tone="positive" />
        <MetricCard label="Success rate" value={`${data.visibleSuccessRate}%`} detail="For attempts visible on this page" tone="positive" />
        <MetricCard label="Needs attention" value={data.visibleFailures} detail="Failed attempts visible now" tone={data.visibleFailures ? "critical" : "neutral"} />
      </div>

      <Panel title="Attempt history" description="Filter by outcome or connected store.">
        <Form method="get" className={styles.filters}>
          <div className={styles.field}>
            <label htmlFor="billing-status">Status</label>
            <select id="billing-status" name="status" defaultValue={data.filters.status}>
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="PROCESSING">Processing</option>
              <option value="SUCCESS">Success</option>
              <option value="FAILURE">Failure</option>
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="billing-shop">Store</label>
            <select id="billing-shop" name="shopId" defaultValue={data.filters.shopId}>
              <option value="">All stores</option>
              {data.shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.displayName || shop.domain}</option>)}
            </select>
          </div>
          <button className={styles.buttonSecondary} type="submit">Apply filters</button>
        </Form>

        {data.attempts.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Attempt</th><th>Store</th><th>Subscription</th><th>Amount</th><th>Status</th><th>Requested</th></tr></thead>
              <tbody>
                {data.attempts.map((attempt) => (
                  <tr key={attempt.id}>
                    <td className={styles.primaryCell}>
                      {attempt.shopifyId?.split("/").at(-1) || attempt.id.slice(-8)}
                      {attempt.errorCode ? <span className={styles.secondaryText}>{attempt.errorCode}</span> : null}
                    </td>
                    <td>{attempt.shop.displayName || attempt.shop.domain}<span className={styles.secondaryText}>{attempt.shop.domain}</span></td>
                    <td>{attempt.contract ? <a className={styles.textLink} href={`/control/subscriptions/${attempt.contract.id}`}>{attempt.contract.customerName || attempt.contract.shopifyId.split("/").at(-1)}</a> : "—"}</td>
                    <td>{attempt.amount ? formatMoney(attempt.amount, attempt.currencyCode || attempt.shop.currencyCode) : "Pending"}</td>
                    <td><StatusBadge value={attempt.status} /></td>
                    <td>{formatDate(attempt.attemptedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="No billing attempts found" description="Charges will appear here after Shopify reports a billing attempt or an operator requests one." />}
        <Pagination page={data.page} pages={data.pages} buildHref={buildHref} />
      </Panel>
    </>
  );
}
