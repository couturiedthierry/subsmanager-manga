// Keep subscription details outside the subscriptions index layout.
import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { hasSubscriptionAccess } from "../lib/access.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { badgeTone, formatDate, formatMoney, numericId } from "../lib/format";
import {
  contractGid,
  loadContractDetail,
  localBillingHistory,
  refreshPendingAttempts,
  runSubscriptionAction,
  saveContractSnapshot,
  SUBSCRIPTION_INTENTS,
} from "../models/subscriptions.server";
import { contractTotal, paymentMethodLabel } from "../lib/subscription-helpers";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  if (!hasSubscriptionAccess(session.scope)) throw redirect("/app/subscriptions");
  const id = contractGid(params.id);
  await refreshPendingAttempts(session.shop, admin, id).catch(() => undefined);
  const detail = await loadContractDetail(admin, id);
  if (!detail.contract) throw new Response("Subscription not found", { status: 404 });
  await saveContractSnapshot(session.shop, detail.contract).catch(() => undefined);
  return {
    contract: detail.contract,
    dueCycle: detail.dueCycle,
    upcoming: detail.upcoming,
    history: await localBillingHistory(id),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  if (!hasSubscriptionAccess(session.scope)) {
    return { ok: false as const, error: "Shopify has not approved subscription access for this app yet" };
  }
  const id = contractGid(params.id);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  if (!(SUBSCRIPTION_INTENTS as readonly string[]).includes(intent)) {
    return { ok: false as const, error: "Unknown subscription action" };
  }
  if ((intent === "charge" || intent === "cancel") && formData.get("confirmation") !== intent.toUpperCase()) {
    return { ok: false as const, error: "Please confirm this action first" };
  }
  try {
    const { summary } = await runSubscriptionAction({
      admin,
      shopDomain: session.shop,
      contractId: id,
      intent,
      cycleIndex: formData.has("cycleIndex") ? Number(formData.get("cycleIndex")) : undefined,
    });
    return { ok: true as const, message: summary };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Action failed" };
  }
};

export default function SubscriptionDetail() {
  const { contract, dueCycle, upcoming, history } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle";
  const pendingIntent = busy ? String(fetcher.formData?.get("intent") || "") : "";

  useEffect(() => {
    if (!fetcher.data || fetcher.state !== "idle") return;
    if (fetcher.data.ok) shopify.toast.show(fetcher.data.message);
    else shopify.toast.show(fetcher.data.error, { isError: true });
  }, [fetcher.data, fetcher.state, shopify]);

  const total = contractTotal(contract);
  const processing = history.some((attempt) => attempt.status === "PENDING" || attempt.status === "PROCESSING");
  const canCharge = contract.status === "ACTIVE" && Boolean(dueCycle) && !processing;
  const closed = contract.status === "CANCELLED" || contract.status === "EXPIRED";
  const submit = (intent: string, extra: Record<string, string> = {}) =>
    fetcher.submit({ intent, ...extra }, { method: "POST" });

  return (
    <s-page heading={`Subscription #${numericId(contract.id)}`}>
      <s-link slot="breadcrumb-actions" href="/app/subscriptions">Subscriptions</s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        loading={pendingIntent === "charge"}
        disabled={!canCharge || busy}
        onClick={() => {
          if (
            canCharge &&
            window.confirm("Has the customer approved this charge? This bills their saved payment method for the due cycle.")
          ) {
            submit("charge", { confirmation: "CHARGE" });
          }
        }}
      >
        Charge due cycle
      </s-button>
      {contract.status === "ACTIVE" ? (
        <s-button slot="secondary-actions" disabled={busy} onClick={() => submit("pause")}>Pause</s-button>
      ) : contract.status === "PAUSED" || contract.status === "FAILED" ? (
        <s-button slot="secondary-actions" disabled={busy} onClick={() => submit("activate")}>Resume</s-button>
      ) : null}

      {fetcher.data && !fetcher.data.ok && fetcher.state === "idle" ? (
        <s-banner tone="critical">{fetcher.data.error}</s-banner>
      ) : null}
      {processing ? (
        <s-banner tone="info">A charge is processing at Shopify. Reload this page in a minute to see the result.</s-banner>
      ) : dueCycle && contract.status === "ACTIVE" ? (
        <s-banner tone="warning" heading="Renewal waiting for approval">
          The renewal due {formatDate(dueCycle.billingAttemptExpectedDate)} has not been charged. Contact the
          customer, then select Charge due cycle.
        </s-banner>
      ) : contract.status === "ACTIVE" ? (
        <s-banner tone="info">
          Renewals are charged manually. The Charge due cycle button turns on once a billing date has passed.
        </s-banner>
      ) : null}

      <s-section heading="Subscription summary">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Status</s-text>
            <s-badge tone={badgeTone(contract.status)}>{contract.status}</s-badge>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Next billing date</s-text>
            <s-text type="strong">{formatDate(contract.nextBillingDate)}</s-text>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Recurring total</s-text>
            <s-text type="strong">{formatMoney(total, contract.currencyCode)}</s-text>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Frequency</s-text>
            <s-text type="strong">
              Every {contract.billingPolicy.intervalCount} {contract.billingPolicy.interval.toLowerCase()}
              {contract.billingPolicy.intervalCount === 1 ? "" : "s"}
            </s-text>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Last payment</s-text>
            {contract.lastPaymentStatus ? (
              <s-badge tone={contract.lastPaymentStatus === "SUCCEEDED" ? "success" : "critical"}>
                {contract.lastPaymentStatus}
              </s-badge>
            ) : <s-text>—</s-text>}
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Origin order</s-text>
            {contract.originOrder ? (
              <s-link href={`shopify://admin/orders/${numericId(contract.originOrder.id)}`}>
                {contract.originOrder.name}
              </s-link>
            ) : <s-text>Not available</s-text>}
          </s-stack>
        </s-grid>
      </s-section>

      <s-section heading="Products">
        <s-table variant="auto">
          <s-table-header-row>
            <s-table-header listSlot="primary">Product</s-table-header>
            <s-table-header format="numeric">Quantity</s-table-header>
            <s-table-header format="currency">Price</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {contract.lines.nodes.map((line) => (
              <s-table-row key={line.id}>
                <s-table-cell>
                  <s-stack direction="inline" gap="small" alignItems="center">
                    {line.variantImage ? (
                      <s-thumbnail src={line.variantImage.url} alt={line.variantImage.altText || line.title} size="small"></s-thumbnail>
                    ) : null}
                    <s-stack direction="block" gap="small">
                      {line.productId ? (
                        <s-link href={`shopify://admin/products/${numericId(line.productId)}`}>{line.title}</s-link>
                      ) : <s-text>{line.title}</s-text>}
                      {line.variantTitle ? <s-text color="subdued">{line.variantTitle}</s-text> : null}
                    </s-stack>
                  </s-stack>
                </s-table-cell>
                <s-table-cell>{line.quantity}</s-table-cell>
                <s-table-cell>{formatMoney(line.lineDiscountedPrice.amount, line.lineDiscountedPrice.currencyCode)}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section heading="Upcoming billing cycles">
        {upcoming.length === 0 ? (
          <s-paragraph color="subdued">No upcoming billing cycles are scheduled.</s-paragraph>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Date</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Action</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {upcoming.map((cycle) => (
                <s-table-row key={cycle.cycleIndex}>
                  <s-table-cell>{formatDate(cycle.billingAttemptExpectedDate)}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={cycle.skipped ? "neutral" : "info"}>{cycle.skipped ? "Skipped" : "Scheduled"}</s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {contract.status === "ACTIVE" ? (
                      <s-button
                        variant="tertiary"
                        disabled={busy}
                        onClick={() => submit(cycle.skipped ? "unskip" : "skip", { cycleIndex: String(cycle.cycleIndex) })}
                      >
                        {cycle.skipped ? "Restore" : "Skip"}
                      </s-button>
                    ) : null}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="Charge history">
        {history.length === 0 ? (
          <s-paragraph color="subdued">No charges have been requested from this app yet.</s-paragraph>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Requested</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Details</s-table-header>
              <s-table-header format="currency">Amount</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {history.map((attempt) => (
                <s-table-row key={attempt.id}>
                  <s-table-cell>{formatDate(attempt.attemptedAt)}</s-table-cell>
                  <s-table-cell><s-badge tone={badgeTone(attempt.status)}>{attempt.status}</s-badge></s-table-cell>
                  <s-table-cell>{attempt.errorCode || "—"}</s-table-cell>
                  <s-table-cell>
                    {attempt.amount ? formatMoney(attempt.amount, attempt.currencyCode || contract.currencyCode) : "—"}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="Customer">
        <s-stack direction="block" gap="base">
          <s-text type="strong">{contract.customer?.displayName || "Customer removed"}</s-text>
          <s-text color="subdued">
            {contract.customer?.defaultEmailAddress?.emailAddress || "No email address"}
          </s-text>
          {contract.customer ? (
            <s-button href={`shopify://admin/customers/${numericId(contract.customer.id)}`}>View in Shopify</s-button>
          ) : null}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Payment method">
        <s-stack direction="block" gap="base">
          <s-text>{paymentMethodLabel(contract)}</s-text>
          <s-button
            disabled={busy || closed || !contract.customerPaymentMethod}
            loading={pendingIntent === "payment-email"}
            onClick={() => submit("payment-email")}
          >
            Send secure update email
          </s-button>
          <s-paragraph color="subdued">
            Card details stay with Shopify and are never stored by SubsManager Manga.
          </s-paragraph>
        </s-stack>
      </s-section>

      {!closed ? (
        <s-section slot="aside" heading="Cancel subscription">
          <s-stack direction="block" gap="base">
            <s-paragraph>Cancelling stops all future billing and cannot be undone.</s-paragraph>
            <s-button
              tone="critical"
              disabled={busy}
              loading={pendingIntent === "cancel"}
              onClick={() => {
                if (window.confirm("Cancel this subscription and stop all future billing? This cannot be undone.")) {
                  submit("cancel", { confirmation: "CANCEL" });
                }
              }}
            >
              Cancel subscription
            </s-button>
          </s-stack>
        </s-section>
      ) : null}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
