import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { requireControlUser } from "../lib/control-auth.server";
import { recurringValue } from "../lib/control-data";
import { controlDashboard } from "../models/control.server";
import { formatDate, formatMoney } from "../lib/format";
import {
  ControlLink,
  EmptyState,
  MetricCard,
  PageHeader,
  Panel,
  StatusBadge,
  styles,
} from "../components/control-ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireControlUser(request);
  return controlDashboard();
};

export default function ControlDashboard() {
  const { metrics, days, recentContracts, activity } = useLoaderData<typeof loader>();
  const chartMax = Math.max(1, ...days.map((day) => Math.max(day.revenue, day.attempts)));

  return (
    <>
      <PageHeader
        eyebrow="Operations overview"
        title="Subscription control center"
        description="Monitor every connected Shopify store, act on customer subscriptions, and review renewal health from one protected workspace."
        actions={<ControlLink to="/control/subscriptions">View all subscriptions</ControlLink>}
      />

      {metrics.stores === 0 ? (
        <Panel>
          <EmptyState
            title="No stores connected yet"
            description="Install SubsManager Manga on a Shopify development store. Its offline session and subscription webhooks will appear here automatically."
          />
        </Panel>
      ) : null}

      <div className={styles.metrics}>
        <MetricCard label="Connected stores" value={metrics.stores} detail="Authorized Shopify installations" tone="positive" />
        <MetricCard label="Active subscriptions" value={metrics.activeContracts} detail="Contracts synced across every store" tone="positive" />
        <MetricCard label="Due for renewal" value={metrics.dueContracts} detail="Billing date passed — waiting for approval" tone={metrics.dueContracts ? "warning" : "positive"} />
        <MetricCard label="30-day renewal revenue" value={formatMoney(metrics.revenue)} detail={`${metrics.failedPayments} failed payment attempts`} tone={metrics.failedPayments ? "warning" : "positive"} />
      </div>

      <div className={styles.gridTwo}>
        <Panel title="Renewal activity" description="Successful revenue and billing-attempt volume over the last seven days">
          <div className={styles.chart} aria-label="Seven-day renewal activity chart">
            {days.map((day) => (
              <div className={styles.chartColumn} key={day.label} title={`${formatMoney(day.revenue)} · ${day.attempts} attempts`}>
                <i style={{ height: `${Math.max(4, (Math.max(day.revenue, day.attempts) / chartMax) * 100)}%` }} />
                <span>{day.label}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Recent operator activity" description="Security and support actions recorded by the backend">
          {activity.length ? (
            <ul className={styles.activityList}>
              {activity.map((event) => (
                <li key={event.id}>
                  <strong>{event.summary}</strong>
                  <span>{event.actorEmail} · {formatDate(event.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No activity yet" description="Sign-ins, synchronization, and subscription actions will be recorded here." />
          )}
        </Panel>
      </div>

      <Panel
        title="Recently updated subscriptions"
        description="The latest contract changes received from Shopify"
        action={<ControlLink to="/control/subscriptions">View all</ControlLink>}
      >
        {recentContracts.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Customer</th><th>Store</th><th>Status</th><th>Next billing</th><th>Recurring value</th></tr></thead>
              <tbody>
                {recentContracts.map((contract) => (
                  <tr key={contract.id}>
                    <td className={styles.primaryCell}>
                      <ControlLink to={`/control/subscriptions/${contract.id}`}>{contract.customerName || "Customer"}</ControlLink>
                      <span className={styles.secondaryText}>{contract.lines[0]?.title || "Subscription contract"}</span>
                    </td>
                    <td>{contract.shop.displayName || contract.shop.domain}<span className={styles.secondaryText}>{contract.shop.domain}</span></td>
                    <td><StatusBadge value={contract.billingDue ? "DUE — NEEDS APPROVAL" : contract.status} /></td>
                    <td>{formatDate(contract.nextBillingAt)}</td>
                    <td>{formatMoney(recurringValue(contract.lines), contract.currencyCode)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No synced contracts" description="Subscription webhooks or a manual store synchronization will populate this view." />
        )}
      </Panel>
    </>
  );
}
