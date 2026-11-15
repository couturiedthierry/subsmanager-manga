// Details of a subscription billed by Seal Subscriptions, managed through Seal's API.
import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { badgeTone, formatDate, formatMoney } from "../lib/format";
import { getSealClient } from "../models/seal-connection.server";
import { SealApiError } from "../lib/seal.server";
import {
  sealAmount,
  sealCustomerName,
  sealPastAttempts,
  sealSkippedAttempts,
  sealUpcomingAttempts,
} from "../lib/seal-helpers";
import prisma from "../db.server";

const INTENTS = ["pause", "resume", "cancel", "skip", "unskip", "charge", "payment-email"] as const;
type Intent = (typeof INTENTS)[number];

function parseId(value: string | undefined) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Response("Subscription not found", { status: 404 });
  return id;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const client = await getSealClient(session.shop);
  if (!client) throw redirect("/app/seal");
  const id = parseId(params.id);
  try {
    const subscription = await client.getSubscription(id);
    if (!subscription?.id) throw new Response("Subscription not found", { status: 404 });
    return {
      subscription,
      upcoming: sealUpcomingAttempts(subscription).slice(0, 6),
      skipped: sealSkippedAttempts(subscription),
      past: sealPastAttempts(subscription).slice(0, 12),
      loadError: null as string | null,
    };
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error instanceof SealApiError && (error.status === 404 || error.status === 400)) {
      throw new Response("Subscription not found", { status: 404 });
    }
    throw error;
  }
};

const SUMMARIES: Record<Intent, string> = {
  pause: "Subscription paused",
  resume: "Subscription resumed",
  cancel: "Subscription cancelled",
  skip: "Order skipped",
  unskip: "Order restored",
  charge: "Charge requested. Seal is processing it now.",
  "payment-email": "Payment update email sent to the customer",
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const client = await getSealClient(session.shop);
  if (!client) return { ok: false as const, error: "Seal is not connected anymore. Connect it again from the Seal page." };
  const id = parseId(params.id);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "") as Intent;
  if (!INTENTS.includes(intent)) return { ok: false as const, error: "Unknown subscription action" };
  if ((intent === "charge" || intent === "cancel") && formData.get("confirmation") !== intent.toUpperCase()) {
    return { ok: false as const, error: "Please confirm this action first" };
  }
  const attemptId = Number(formData.get("attemptId"));
  if ((intent === "skip" || intent === "unskip") && (!Number.isSafeInteger(attemptId) || attemptId <= 0)) {
    return { ok: false as const, error: "Choose which order to skip" };
  }
  try {
    switch (intent) {
      case "pause":
        await client.updateSubscription(id, "pause");
        break;
      case "resume":
        await client.updateSubscription(id, "resume");
        break;
      case "cancel":
        await client.updateSubscription(id, "cancel");
        break;
      case "payment-email":
        await client.updateSubscription(id, "send_payment_method_update_email");
        break;
      case "charge":
        await client.chargeNow(id);
        break;
      case "skip":
      case "unskip":
        await client.updateBillingAttempt(id, attemptId, intent);
        break;
    }
    await prisma.auditEvent.create({
      data: {
        shopDomain: session.shop,
        actorEmail: session.onlineAccessInfo?.associated_user?.email || "shop-staff",
        actorRole: "MERCHANT",
        action: `seal.subscription.${intent}`,
        resourceType: "seal_subscription",
        resourceId: String(id),
        summary: SUMMARIES[intent],
      },
    }).catch(() => undefined);
    return { ok: true as const, message: SUMMARIES[intent] };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof SealApiError ? error.message : "Seal could not complete this action. Try again.",
    };
  }
};

export default function SealSubscriptionDetail() {
  const { subscription, upcoming, skipped, past } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle";
  const pendingIntent = busy ? String(fetcher.formData?.get("intent") || "") : "";
  const status = String(subscription.status || "").toUpperCase();
  const closed = status === "CANCELLED" || status === "EXPIRED";
  const currency = subscription.currency || "USD";

  useEffect(() => {
    if (!fetcher.data || fetcher.state !== "idle") return;
    if (fetcher.data.ok) shopify.toast.show(fetcher.data.message);
    else shopify.toast.show(fetcher.data.error, { isError: true });
  }, [fetcher.data, fetcher.state, shopify]);

  const submit = (intent: Intent, extra: Record<string, string> = {}) =>
    fetcher.submit({ intent, ...extra }, { method: "POST" });

  const card = subscription.card_last_digits
    ? `${(subscription.card_brand || "Card").replace(/^\w/, (c) => c.toUpperCase())} ending in ${subscription.card_last_digits}${
        subscription.card_expiry_month ? ` (expires ${subscription.card_expiry_month}/${subscription.card_expiry_year})` : ""
      }`
    : "No card details from Seal";

  return (
    <s-page heading={`Subscription #${subscription.id}`}>
      <s-link slot="breadcrumb-actions" href="/app/subscriptions">Subscriptions</s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        disabled={busy || status !== "ACTIVE"}
        loading={pendingIntent === "charge"}
        onClick={() => {
          if (window.confirm("Charge this subscription now? Seal bills the customer's saved payment method right away.")) {
            submit("charge", { confirmation: "CHARGE" });
          }
        }}
      >
        Charge now
      </s-button>
      {status === "ACTIVE" ? (
        <s-button slot="secondary-actions" disabled={busy} onClick={() => submit("pause")}>Pause</s-button>
      ) : status === "PAUSED" ? (
        <s-button slot="secondary-actions" disabled={busy} onClick={() => submit("resume")}>Resume</s-button>
      ) : null}

      <s-banner tone="info">
        This subscription is billed by Seal Subscriptions. Seal charges it automatically on each billing date,
        and every change here is sent to Seal.
      </s-banner>
      {fetcher.data && !fetcher.data.ok && fetcher.state === "idle" ? (
        <s-banner tone="critical">{fetcher.data.error}</s-banner>
      ) : null}

      <s-section heading="Subscription summary">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Status</s-text>
            <s-badge tone={badgeTone(status || "ACTIVE")}>{status || "UNKNOWN"}</s-badge>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Next billing date</s-text>
            <s-text type="strong">{status === "ACTIVE" ? formatDate(upcoming[0]?.date) : "Not scheduled"}</s-text>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Recurring total</s-text>
            <s-text type="strong">{formatMoney(sealAmount(subscription), currency)}</s-text>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Frequency</s-text>
            <s-text type="strong">{subscription.billing_interval ? `Every ${subscription.billing_interval}` : "—"}</s-text>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">Started</s-text>
            <s-text type="strong">{formatDate(subscription.order_placed)}</s-text>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text color="subdued">First order</s-text>
            {subscription.order_id ? (
              <s-link href={`shopify://admin/orders/${subscription.order_id}`}>View order</s-link>
            ) : <s-text>Not available</s-text>}
          </s-stack>
        </s-grid>
      </s-section>

      <s-section heading="Products">
        {(subscription.items || []).length === 0 ? (
          <s-paragraph color="subdued">No products on this subscription.</s-paragraph>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Product</s-table-header>
              <s-table-header format="numeric">Quantity</s-table-header>
              <s-table-header format="currency">Price</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {(subscription.items || []).map((item) => (
                <s-table-row key={item.id}>
                  <s-table-cell>
                    <s-stack direction="block" gap="small">
                      {item.product_id ? (
                        <s-link href={`shopify://admin/products/${item.product_id}`}>{item.title}</s-link>
                      ) : <s-text>{item.title}</s-text>}
                      {item.selling_plan_name ? <s-text color="subdued">{item.selling_plan_name}</s-text> : null}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{item.quantity}</s-table-cell>
                  <s-table-cell>{formatMoney(item.final_price ?? item.price, currency)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="Upcoming orders">
        {upcoming.length === 0 && skipped.length === 0 ? (
          <s-paragraph color="subdued">No upcoming orders are scheduled.</s-paragraph>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Date</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Action</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {[...upcoming.map((attempt) => ({ attempt, isSkipped: false })), ...skipped.map((attempt) => ({ attempt, isSkipped: true }))]
                .sort((a, b) => new Date(a.attempt.date).getTime() - new Date(b.attempt.date).getTime())
                .map(({ attempt, isSkipped }) => (
                  <s-table-row key={attempt.id}>
                    <s-table-cell>{formatDate(attempt.date)}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={isSkipped ? "neutral" : "info"}>{isSkipped ? "Skipped" : "Scheduled"}</s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      {status === "ACTIVE" ? (
                        <s-button
                          variant="tertiary"
                          disabled={busy}
                          onClick={() => submit(isSkipped ? "unskip" : "skip", { attemptId: String(attempt.id) })}
                        >
                          {isSkipped ? "Restore" : "Skip"}
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
        {past.length === 0 ? (
          <s-paragraph color="subdued">No renewals have been charged yet.</s-paragraph>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Date</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Details</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {past.map((attempt) => {
                const failed = Boolean(attempt.error_code || attempt.error_message);
                return (
                  <s-table-row key={attempt.id}>
                    <s-table-cell>{formatDate(attempt.completed_at || attempt.date)}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={failed ? "critical" : attempt.order_id ? "success" : "warning"}>
                        {failed ? "Failed" : attempt.order_id ? "Paid" : String(attempt.status || "Processing")}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      {attempt.order_id ? (
                        <s-link href={`shopify://admin/orders/${attempt.order_id}`}>View order</s-link>
                      ) : attempt.error_message || "—"}
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="Customer">
        <s-stack direction="block" gap="base">
          <s-text type="strong">{sealCustomerName(subscription)}</s-text>
          <s-text color="subdued">{subscription.email || "No email address"}</s-text>
          {subscription.s_address1 ? (
            <s-text color="subdued">
              {[subscription.s_address1, subscription.s_city, subscription.s_province_code, subscription.s_zip, subscription.s_country_code]
                .filter(Boolean)
                .join(", ")}
            </s-text>
          ) : null}
          {subscription.customer_id ? (
            <s-button href={`shopify://admin/customers/${subscription.customer_id}`}>View in Shopify</s-button>
          ) : null}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Payment method">
        <s-stack direction="block" gap="base">
          <s-text>{card}</s-text>
          <s-button
            disabled={busy || closed}
            loading={pendingIntent === "payment-email"}
            onClick={() => submit("payment-email")}
          >
            Send secure update email
          </s-button>
          <s-paragraph color="subdued">Card details stay with Shopify and are never stored by SubsManager Manga.</s-paragraph>
        </s-stack>
      </s-section>

      {!closed ? (
        <s-section slot="aside" heading="Cancel subscription">
          <s-stack direction="block" gap="base">
            <s-paragraph>Cancelling stops all future billing.</s-paragraph>
            <s-button
              tone="critical"
              disabled={busy}
              loading={pendingIntent === "cancel"}
              onClick={() => {
                if (window.confirm("Cancel this subscription and stop all future billing?")) {
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
