import type { LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { requireControlUser } from "../lib/control-auth.server";
import { recurringValue } from "../lib/control-data";
import { controlSubscriptions } from "../models/control.server";
import { formatDate, formatMoney } from "../lib/format";
import {
  ControlLink,
  EmptyState,
  PageHeader,
  Pagination,
  Panel,
  StatusBadge,
  styles,
} from "../components/control-ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireControlUser(request);
  const url = new URL(request.url);
  const filters = {
    query: url.searchParams.get("q") || "",
    status: url.searchParams.get("status") || "",
    shopId: url.searchParams.get("shop") || "",
    page: Number(url.searchParams.get("page") || 1),
  };
  return { ...(await controlSubscriptions(filters)), filters };
};

export default function ControlSubscriptions() {
  const { records, shops, total, page, pages, filters } = useLoaderData<typeof loader>();
  const pageHref = (target: number) => {
    const params = new URLSearchParams();
    if (filters.query) params.set("q", filters.query);
    if (filters.status) params.set("status", filters.status);
    if (filters.shopId) params.set("shop", filters.shopId);
    params.set("page", String(target));
    return `/control/subscriptions?${params.toString()}`;
  };

  return (
    <>
      <PageHeader
        eyebrow="Customer contracts"
        title="Subscriptions"
        description="Search and manage Shopify subscription contracts across every authorized store."
      />
      <Panel>
        <Form className={styles.filters} method="get">
          <div className={styles.field}>
            <label htmlFor="subscription-search">Search</label>
            <input id="subscription-search" name="q" defaultValue={filters.query} placeholder="Customer, contract, or store" />
          </div>
          <div className={styles.field}>
            <label htmlFor="subscription-status">Status</label>
            <select id="subscription-status" name="status" defaultValue={filters.status}>
              <option value="">All statuses</option>
              <option value="DUE">Due — waiting for approval</option>
              <option value="ACTIVE">Active</option>
              <option value="PAUSED">Paused</option>
              <option value="FAILED">Failed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="subscription-store">Store</label>
            <select id="subscription-store" name="shop" defaultValue={filters.shopId}>
              <option value="">All stores</option>
              {shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.displayName || shop.domain}</option>)}
            </select>
          </div>
          <button className={styles.buttonSecondary} type="submit">Apply filters</button>
        </Form>
      </Panel>

      <Panel title={`${total} subscription${total === 1 ? "" : "s"}`} description="Cached locally from authenticated Shopify webhooks and store synchronization">
        {records.length ? (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Customer</th><th>Store</th><th>Status</th><th>Next billing</th><th>Last payment</th><th>Recurring value</th></tr></thead>
                <tbody>
                  {records.map((contract) => (
                    <tr key={contract.id}>
                      <td className={styles.primaryCell}>
                        <ControlLink to={`/control/subscriptions/${contract.id}`}>{contract.customerName || "Customer"}</ControlLink>
                        <span className={styles.secondaryText}>{contract.lines[0]?.title || contract.shopifyId.split("/").at(-1)}</span>
                      </td>
                      <td><ControlLink to={`/control/stores/${contract.shop.id}`}>{contract.shop.displayName || contract.shop.domain}</ControlLink><span className={styles.secondaryText}>{contract.shop.domain}</span></td>
                      <td><StatusBadge value={contract.billingDue ? "DUE — NEEDS APPROVAL" : contract.status} /></td>
                      <td>{formatDate(contract.nextBillingAt)}</td>
                      <td>{contract.lastPaymentStatus ? <StatusBadge value={contract.lastPaymentStatus} /> : "—"}</td>
                      <td>{formatMoney(recurringValue(contract.lines), contract.currencyCode)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pages={pages} buildHref={pageHref} />
          </>
        ) : (
          <EmptyState title="No subscriptions found" description="Try another filter, synchronize a connected store, or wait for Shopify subscription webhooks." />
        )}
      </Panel>
    </>
  );
}
