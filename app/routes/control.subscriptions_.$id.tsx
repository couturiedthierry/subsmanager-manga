// Keep subscription details outside the subscriptions index layout.
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
import { formatDate, formatMoney, numericId } from "../lib/format";
import { parseContractLines, recurringValue } from "../lib/control-data";
import {
  loadContractDetail,
  localBillingHistory,
  refreshPendingAttempts,
  runSubscriptionAction,
  saveContractSnapshot,
  SUBSCRIPTION_INTENTS,
} from "../models/subscriptions.server";
import { contractTotal, paymentMethodLabel } from "../lib/subscription-helpers";
import {
  ControlLink,
  Notice,
  PageHeader,
  Panel,
  StatusBadge,
  styles,
  useControlContext,
} from "../components/control-ui";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await requireControlUser(request);
  const record = params.id
    ? await prisma.subscriptionContract.findUnique({ where: { id: params.id }, include: { shop: true } })
    : null;
  if (!record) throw new Response("Subscription not found", { status: 404 });
  let live: Awaited<ReturnType<typeof loadContractDetail>> | null = null;
  let liveError: string | null = null;
  try {
    const { admin } = await unauthenticated.admin(record.shop.domain);
    await refreshPendingAttempts(record.shop.domain, admin, record.shopifyId);
    live = await loadContractDetail(admin, record.shopifyId);
    if (live.contract) await saveContractSnapshot(record.shop.domain, live.contract);
    else liveError = "Shopify no longer returns this contract.";
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    liveError = /could not find a session/i.test(message)
      ? "This store is not connected. The app was uninstalled, or the merchant must open it from Shopify Admin once to reconnect."
      : message || "Could not load the live Shopify contract";
  }
  const url = new URL(request.url);
  return {
    record: {
      id: record.id,
      shopifyId: record.shopifyId,
      status: record.status,
      customerName: record.customerName,
      customerId: record.customerId,
      currencyCode: record.currencyCode,
      nextBillingAt: record.nextBillingAt,
      lines: parseContractLines(record.linesJson),
      shop: { id: record.shop.id, domain: record.shop.domain, displayName: record.shop.displayName },
    },
    contract: live?.contract ?? null,
    dueCycle: live?.dueCycle ?? null,
    upcoming: live?.upcoming ?? [],
    history: await localBillingHistory(record.shopifyId),
    liveError,
    notice: url.searchParams.get("notice"),
    error: url.searchParams.get("error"),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  assertControlOrigin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const privileged = intent === "cancel" || intent === "charge";
  const auth = await requireControlUser(
    request,
    privileged ? controlRoles.administrators : controlRoles.operators,
  );
  assertControlCsrf(formData, auth);
  const record = params.id
    ? await prisma.subscriptionContract.findUnique({ where: { id: params.id }, include: { shop: true } })
    : null;
  if (!record) throw new Response("Subscription not found", { status: 404 });
  const back = (type: "notice" | "error", message: string) =>
    redirect(`/control/subscriptions/${record.id}?${type}=${encodeURIComponent(message)}`);
  if (!(SUBSCRIPTION_INTENTS as readonly string[]).includes(intent)) return back("error", "Unknown action");
  if (privileged && String(formData.get("confirmation")) !== intent.toUpperCase()) {
    return back("error", "Confirmation was missing");
  }

  try {
    const { admin } = await unauthenticated.admin(record.shop.domain);
    const { summary } = await runSubscriptionAction({
      admin,
      shopDomain: record.shop.domain,
      contractId: record.shopifyId,
      intent,
      cycleIndex: formData.has("cycleIndex") ? Number(formData.get("cycleIndex")) : undefined,
    });
    await writeAudit({
      actor: auth.user,
      request,
      action: `SUBSCRIPTION_${intent.replace(/-/g, "_").toUpperCase()}`,
      resourceType: "SUBSCRIPTION_CONTRACT",
      resourceId: record.id,
      summary,
      shop: record.shop,
      metadata: { shopifyId: record.shopifyId },
    });
    return back("notice", summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Subscription action failed";
    await writeAudit({
      actor: auth.user,
      request,
      action: `SUBSCRIPTION_${intent.replace(/-/g, "_").toUpperCase()}_FAILED`,
      resourceType: "SUBSCRIPTION_CONTRACT",
      resourceId: record.id,
      summary: `Failed: ${message}`.slice(0, 300),
      shop: record.shop,
    }).catch(() => undefined);
    return back("error", message);
  }
};

export default function ControlSubscriptionDetail() {
  const { record, contract, dueCycle, upcoming, history, liveError, notice, error } = useLoaderData<typeof loader>();
  const { csrfToken, user } = useControlContext();
  const navigation = useNavigation();
  const total = contract ? contractTotal(contract) : recurringValue(record.lines);
  const canOperate = user.role !== "VIEWER";
  const canAdminister = user.role === "OWNER" || user.role === "ADMIN";
  const busy = navigation.state !== "idle";
  const status = contract?.status || record.status;
  const processing = history.some((attempt) => attempt.status === "PENDING" || attempt.status === "PROCESSING");
  const lastFailure = history.find((attempt) => attempt.status === "FAILURE");

  return (
    <>
      <PageHeader
        eyebrow={`${record.shop.displayName || record.shop.domain} · Contract ${numericId(record.shopifyId)}`}
        title={contract?.customer?.displayName || record.customerName || "Subscription contract"}
        description={contract?.lines.nodes[0]?.title || "Live Shopify subscription management"}
        actions={<ControlLink to="/control/subscriptions">Back to subscriptions</ControlLink>}
      />
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice tone="critical">{error}</Notice> : null}
      {liveError ? <Notice tone="critical">Live Shopify data is unavailable: {liveError}</Notice> : null}
      {processing ? (
        <Notice tone="info">A charge is processing at Shopify. Refresh in a minute to see the result.</Notice>
      ) : dueCycle && status === "ACTIVE" ? (
        <Notice tone="warning">
          The renewal due {formatDate(dueCycle.billingAttemptExpectedDate)} is waiting for approval. Contact the
          customer, then use “Charge due cycle”.
        </Notice>
      ) : null}

      <div className={styles.detailGrid}>
        <div>
          <Panel title="Subscription summary">
            <dl className={styles.summaryList}>
              <div><dt>Status</dt><dd><StatusBadge value={status} /></dd></div>
              <div><dt>Recurring total</dt><dd>{formatMoney(total, contract?.currencyCode || record.currencyCode)}</dd></div>
              <div><dt>Delivery</dt><dd>{contract ? formatMoney(contract.deliveryPrice.amount, contract.deliveryPrice.currencyCode) : "—"}</dd></div>
              <div><dt>Next billing</dt><dd>{formatDate(contract?.nextBillingDate || record.nextBillingAt)}</dd></div>
              <div><dt>Billing frequency</dt><dd>{contract ? `Every ${contract.billingPolicy.intervalCount} ${contract.billingPolicy.interval.toLowerCase()}${contract.billingPolicy.intervalCount === 1 ? "" : "s"}` : "Unavailable"}</dd></div>
              <div><dt>Last payment</dt><dd>{contract?.lastPaymentStatus ? <StatusBadge value={contract.lastPaymentStatus} /> : "—"}</dd></div>
              <div><dt>Origin order</dt><dd>{contract?.originOrder?.name || "—"}</dd></div>
              <div><dt>Payment method</dt><dd>{contract ? paymentMethodLabel(contract) : "Unavailable"}</dd></div>
            </dl>
          </Panel>

          <Panel title="Products">
            {contract?.lines.nodes.length ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Product</th><th>Variant</th><th>Quantity</th><th>Price</th></tr></thead>
                  <tbody>
                    {contract.lines.nodes.map((line) => (
                      <tr key={line.id}>
                        <td className={styles.primaryCell}>{line.title}</td>
                        <td>{line.variantTitle || "Default"}</td>
                        <td>{line.quantity}</td>
                        <td>{formatMoney(line.lineDiscountedPrice.amount, line.lineDiscountedPrice.currencyCode)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : record.lines.length ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Product</th><th>Quantity</th><th>Price</th></tr></thead>
                  <tbody>
                    {record.lines.map((line, index) => (
                      <tr key={`${line.title}-${index}`}>
                        <td className={styles.primaryCell}>{line.title}<span className={styles.secondaryText}>Last synced copy</span></td>
                        <td>{line.quantity}</td>
                        <td>{formatMoney(line.lineDiscountedPrice?.amount, line.lineDiscountedPrice?.currencyCode || record.currencyCode)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className={styles.panelBody}>Product details are unavailable.</div>}
          </Panel>

          <Panel title="Upcoming billing cycles" description="Skipping a cycle moves the customer straight to the next one.">
            {upcoming.length ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Cycle</th><th>Date</th><th>Status</th><th>Action</th></tr></thead>
                  <tbody>
                    {upcoming.map((cycle) => (
                      <tr key={cycle.cycleIndex}>
                        <td>#{cycle.cycleIndex}</td>
                        <td>{formatDate(cycle.billingAttemptExpectedDate)}</td>
                        <td><StatusBadge value={cycle.skipped ? "Skipped" : "Scheduled"} /></td>
                        <td>
                          {canOperate && status === "ACTIVE" ? (
                            <Form method="post">
                              <input type="hidden" name="_csrf" value={csrfToken} />
                              <input type="hidden" name="intent" value={cycle.skipped ? "unskip" : "skip"} />
                              <input type="hidden" name="cycleIndex" value={cycle.cycleIndex} />
                              <button className={styles.buttonGhost} type="submit" disabled={busy}>
                                {cycle.skipped ? "Restore cycle" : "Skip cycle"}
                              </button>
                            </Form>
                          ) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className={styles.panelBody}>No upcoming billing cycles are scheduled.</div>}
          </Panel>

          <Panel title="Charge history" description="Charges requested from this app and their Shopify results.">
            {history.length ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Requested</th><th>Status</th><th>Amount</th><th>Details</th></tr></thead>
                  <tbody>
                    {history.map((attempt) => (
                      <tr key={attempt.id}>
                        <td>{new Date(attempt.attemptedAt).toLocaleString("en-US")}</td>
                        <td><StatusBadge value={attempt.status} /></td>
                        <td>{attempt.amount ? formatMoney(attempt.amount, attempt.currencyCode || record.currencyCode) : "—"}</td>
                        <td>{attempt.errorCode || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className={styles.panelBody}>No charges have been requested from this app yet.</div>}
          </Panel>
        </div>

        <aside>
          <Panel title="Customer">
            <dl className={styles.summaryList}>
              <div><dt>Name</dt><dd>{contract?.customer?.displayName || record.customerName || "Customer"}</dd></div>
              <div><dt>Email</dt><dd>{contract?.customer?.defaultEmailAddress?.emailAddress || "Not available"}</dd></div>
              <div><dt>Shopify customer</dt><dd>{numericId(contract?.customer?.id || record.customerId) || "—"}</dd></div>
              <div><dt>Store</dt><dd><ControlLink to={`/control/stores/${record.shop.id}`}>{record.shop.displayName || record.shop.domain}</ControlLink></dd></div>
            </dl>
          </Panel>

          {canOperate && contract ? (
            <Panel title="Support actions" description="Every action is permission-checked and added to the audit log.">
              <div className={styles.actionGrid}>
                {contract.status === "ACTIVE" ? (
                  <ActionForm csrfToken={csrfToken} intent="pause" label="Pause" disabled={busy} />
                ) : contract.status === "PAUSED" || contract.status === "FAILED" ? (
                  <ActionForm csrfToken={csrfToken} intent="activate" label="Resume" disabled={busy} />
                ) : null}
                <ActionForm csrfToken={csrfToken} intent="payment-email" label="Send payment update email" disabled={busy || !contract.customerPaymentMethod || contract.status === "CANCELLED"} />
              </div>
            </Panel>
          ) : null}

          {canAdminister && contract ? (
            <Panel title="Privileged actions" description="Charges are manual. Confirm with the customer before charging a due cycle.">
              <div className={styles.actionGrid}>
                <Form method="post" onSubmit={(event) => { if (!window.confirm("Has the customer approved this charge? This bills their saved payment method for the due cycle.")) event.preventDefault(); }}>
                  <input type="hidden" name="_csrf" value={csrfToken} />
                  <input type="hidden" name="intent" value="charge" />
                  <input type="hidden" name="confirmation" value="CHARGE" />
                  <button className={styles.button} type="submit" disabled={busy || !dueCycle || processing || contract.status !== "ACTIVE"}>
                    {lastFailure && dueCycle ? "Retry charge for due cycle" : "Charge due cycle"}
                  </button>
                </Form>
                <Form method="post" onSubmit={(event) => { if (!window.confirm("Cancel this subscription and stop all future billing? This cannot be undone.")) event.preventDefault(); }}>
                  <input type="hidden" name="_csrf" value={csrfToken} />
                  <input type="hidden" name="intent" value="cancel" />
                  <input type="hidden" name="confirmation" value="CANCEL" />
                  <button className={styles.buttonDanger} type="submit" disabled={busy || contract.status === "CANCELLED" || contract.status === "EXPIRED"}>Cancel subscription</button>
                </Form>
              </div>
              {!dueCycle && contract.status === "ACTIVE" ? (
                <p className={styles.secondaryText}>The charge button turns on when a billing date has passed.</p>
              ) : null}
            </Panel>
          ) : null}

          <Panel title="Data handling">
            <div className={styles.panelBody}>
              <p className={styles.pageDescription}>Payment credentials stay with Shopify. SubsManager Manga only shows the masked card details Shopify returns.</p>
            </div>
          </Panel>
        </aside>
      </div>
    </>
  );
}

function ActionForm({ csrfToken, intent, label, disabled }: { csrfToken: string; intent: string; label: string; disabled: boolean }) {
  return (
    <Form method="post">
      <input type="hidden" name="_csrf" value={csrfToken} />
      <input type="hidden" name="intent" value={intent} />
      <button className={styles.buttonSecondary} type="submit" disabled={disabled}>{label}</button>
    </Form>
  );
}
