import type { LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { EmptyState, PageHeader, Pagination, Panel, StatusBadge, styles } from "../components/control-ui";
import { requireControlUser } from "../lib/control-auth.server";
import { controlActivity } from "../models/control.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireControlUser(request);
  const url = new URL(request.url);
  const filters = {
    action: url.searchParams.get("action") || "",
    shopId: url.searchParams.get("shopId") || "",
  };
  return {
    ...(await controlActivity({
      action: filters.action || undefined,
      shopId: filters.shopId || undefined,
      page: Number(url.searchParams.get("page") || 1),
    })),
    filters,
  };
};

export default function ControlActivity() {
  const data = useLoaderData<typeof loader>();
  const buildHref = (page: number) => {
    const params = new URLSearchParams(data.filters);
    params.set("page", String(page));
    return `/control/activity?${params}`;
  };

  return (
    <>
      <PageHeader
        eyebrow="Accountability"
        title="Activity log"
        description="A tamper-resistant operational history of staff sign-ins and every protected subscription action."
      />
      <Panel title="Audit events" description={`${data.total} recorded event${data.total === 1 ? "" : "s"}`}>
        <Form method="get" className={styles.filters}>
          <div className={styles.field}>
            <label htmlFor="activity-action">Action</label>
            <select id="activity-action" name="action" defaultValue={data.filters.action}>
              <option value="">All actions</option>
              {data.actions.map((action) => <option key={action} value={action}>{action.replaceAll("_", " ")}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="activity-shop">Store</label>
            <select id="activity-shop" name="shopId" defaultValue={data.filters.shopId}>
              <option value="">All stores</option>
              {data.shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.displayName || shop.domain}</option>)}
            </select>
          </div>
          <button className={styles.buttonSecondary} type="submit">Apply filters</button>
        </Form>
        {data.events.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>When</th><th>Operator</th><th>Action</th><th>Store</th><th>Details</th></tr></thead>
              <tbody>
                {data.events.map((event) => (
                  <tr key={event.id}>
                    <td>{new Date(event.createdAt).toLocaleString()}</td>
                    <td className={styles.primaryCell}>{event.actorEmail}<span className={styles.secondaryText}>{event.actorRole.toLowerCase()}</span></td>
                    <td><StatusBadge value={event.action.replaceAll("_", " ")} /></td>
                    <td>{event.shop?.displayName || event.shopDomain || "Control center"}</td>
                    <td>{event.summary}{event.resourceId ? <span className={styles.secondaryText}>Resource {event.resourceId.slice(-12)}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="No activity found" description="Protected operator actions will be recorded here automatically." />}
        <Pagination page={data.page} pages={data.pages} buildHref={buildHref} />
      </Panel>
    </>
  );
}
