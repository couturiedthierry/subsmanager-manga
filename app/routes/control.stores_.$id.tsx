// Keep store details outside the stores index layout.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  assertControlCsrf,
  assertControlOrigin,
  controlRoles,
  requireControlUser,
  writeAudit,
} from "../lib/control-auth.server";
import { recurringValue } from "../lib/control-data";
import { controlStoreDetail, syncStoreSnapshot } from "../models/control.server";
import { formatDate, formatMoney } from "../lib/format";
import {
  ControlLink,
  EmptyState,
  MetricCard,
  Notice,
  PageHeader,
  Panel,
  StatusBadge,
  styles,
  useControlContext,
} from "../components/control-ui";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await requireControlUser(request);
  const store = params.id ? await controlStoreDetail(params.id) : null;
  if (!store) throw new Response("Store not found", { status: 404 });
  const url = new URL(request.url);
  return { store, notice: url.searchParams.get("notice"), error: url.searchParams.get("error") };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  assertControlOrigin(request);
  const auth = await requireControlUser(request, controlRoles.operators);
  const formData = await request.formData();
  assertControlCsrf(formData, auth);
  const shop = params.id ? await prisma.shop.findUnique({ where: { id: params.id } }) : null;
  if (!shop) throw new Response("Store not found", { status: 404 });
  try {
    const { admin } = await unauthenticated.admin(shop.domain);
    const result = await syncStoreSnapshot(shop.domain, admin);
    await writeAudit({
      actor: auth.user,
      request,
      action: "STORE_SYNCED",
      resourceType: "SHOP",
      resourceId: shop.id,
      summary: `Synchronized ${result.contracts} contracts (${result.due} due) and ${result.plans} plan groups`,
      shop,
      metadata: { contracts: result.contracts, plans: result.plans },
    });
    return redirect(`/control/stores/${shop.id}?notice=${encodeURIComponent(`Synchronized ${result.contracts} subscriptions and ${result.plans} plans`)}`);
  } catch (error) {
    const raw = error instanceof Error ? error.message : "";
    const message = /could not find a session/i.test(raw)
      ? "This store is not connected. The merchant must open the app from Shopify Admin to reconnect."
      : raw || "Store synchronization failed";
    return redirect(`/control/stores/${shop.id}?error=${encodeURIComponent(message)}`);
  }
};

export default function ControlStoreDetail() {
  const { store, notice, error } = useLoaderData<typeof loader>();
  const { csrfToken, user } = useControlContext();
  const navigation = useNavigation();
  const active = store.contracts.filter((contract) => contract.status === "ACTIVE").length;
  const failures = store.billingAttempts.filter((attempt) => attempt.status === "FAILURE").length;
  const canOperate = user.role !== "VIEWER";

  return (
    <>
      <PageHeader
        eyebrow="Store workspace"
        title={store.displayName || store.domain}
        description={store.domain}
        actions={
          canOperate ? (
            <Form method="post">
              <input type="hidden" name="_csrf" value={csrfToken} />
              <button className={styles.button} type="submit" disabled={!store.connected || navigation.state !== "idle"}>
                {navigation.state === "submitting" ? "Synchronizing…" : "Synchronize Shopify"}
              </button>
            </Form>
          ) : null
        }
      />
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice tone="critical">{error}</Notice> : null}
      {!store.connected ? <Notice tone="critical">This store has no usable offline Shopify session. Reinstall or reauthorize the app before attempting live operations.</Notice> : null}

      <div className={styles.metrics}>
        <MetricCard label="Connection" value={store.connected ? "Online" : "Offline"} detail="Offline Shopify authorization" tone={store.connected ? "positive" : "critical"} />
        <MetricCard label="Active contracts" value={active} detail={`${store.contracts.length} recently updated contracts`} tone="positive" />
        <MetricCard label="Selling plans" value={store.plans.length} detail="Cached plan groups" />
        <MetricCard label="Failed payments" value={failures} detail="Within recent billing attempts" tone={failures ? "warning" : "positive"} />
      </div>

      <div className={styles.gridTwo}>
        <Panel title="Recent subscriptions" action={<ControlLink to={`/control/subscriptions?shop=${store.id}`}>View all</ControlLink>}>
          {store.contracts.length ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Customer</th><th>Status</th><th>Next billing</th><th>Value</th></tr></thead>
                <tbody>
                  {store.contracts.map((contract) => (
                    <tr key={contract.id}>
                      <td className={styles.primaryCell}><ControlLink to={`/control/subscriptions/${contract.id}`}>{contract.customerName || "Customer"}</ControlLink><span className={styles.secondaryText}>{contract.lines[0]?.title || "Subscription"}</span></td>
                      <td><StatusBadge value={contract.status} /></td>
                      <td>{formatDate(contract.nextBillingAt)}</td>
                      <td>{formatMoney(recurringValue(contract.lines), contract.currencyCode)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="No cached subscriptions" description="Use Synchronize Shopify or wait for subscription webhooks." />}
        </Panel>

        <Panel title="Store configuration">
          <dl className={styles.summaryList}>
            <div><dt>Shopify domain</dt><dd>{store.domain}</dd></div>
            <div><dt>Currency</dt><dd>{store.currencyCode}</dd></div>
            <div><dt>Customer follow-ups</dt><dd>{store.dunningRetries}</dd></div>
            <div><dt>Follow-up interval</dt><dd>{store.retryIntervalDays} days</dd></div>
            <div><dt>Reply-to email</dt><dd>{store.supportEmail || "Not configured"}</dd></div>
            <div><dt>Customer emails</dt><dd>{store.emailsEnabled ? "On" : "Off"}</dd></div>
            {store.emailsEnabled ? (
              <div>
                <dt>Emails sent</dt>
                <dd>
                  {[
                    store.emailWelcome && "Welcome",
                    store.emailRenewalReminder && `Reminder (${store.reminderDaysBefore} days before)`,
                    store.emailPaymentFailed && "Payment failed",
                    store.emailStatusChange && "Status changes",
                  ].filter(Boolean).join(" · ") || "None selected"}
                </dd>
              </div>
            ) : null}
            <div><dt>Last updated</dt><dd>{formatDate(store.updatedAt)}</dd></div>
          </dl>
        </Panel>
      </div>

      <div className={styles.gridEqual}>
        <Panel title="Recent billing attempts">
          {store.billingAttempts.length ? (
            <ul className={styles.activityList}>
              {store.billingAttempts.map((attempt) => (
                <li key={attempt.id}><strong>{attempt.amount ? formatMoney(attempt.amount, attempt.currencyCode || store.currencyCode) : "Billing attempt"} · {attempt.status}</strong><span>{formatDate(attempt.attemptedAt)}{attempt.errorCode ? ` · ${attempt.errorCode}` : ""}</span></li>
              ))}
            </ul>
          ) : <EmptyState title="No billing attempts" description="Shopify renewal results will appear here." />}
        </Panel>
        <Panel title="Webhook health">
          {store.webhookEvents.length ? (
            <ul className={styles.activityList}>
              {store.webhookEvents.map((event) => <li key={event.id}><strong>{event.topic}</strong><span>{formatDate(event.processedAt)}</span></li>)}
            </ul>
          ) : <EmptyState title="No webhooks recorded" description="Webhook delivery begins after the app is installed and subscribed." />}
        </Panel>
      </div>
    </>
  );
}
