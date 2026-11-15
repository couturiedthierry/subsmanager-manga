// Connect SubsManager Manga to the Seal Subscriptions API.
import { useEffect, useRef } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { formatDate } from "../lib/format";
import { connectSeal, disconnectSeal, getSealClient, sealConnectionStatus } from "../models/seal-connection.server";
import { holdUpcomingSealRenewals, releaseSealHolds } from "../models/seal-renewals.server";
import prisma from "../db.server";
import { ensureShop } from "../models/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [status, shop, held, due] = await Promise.all([
    sealConnectionStatus(session.shop),
    ensureShop(session.shop),
    prisma.sealHeldAttempt.count({ where: { shopDomain: session.shop, state: "HELD", billingDate: { gt: new Date() } } }),
    prisma.sealHeldAttempt.count({ where: { shopDomain: session.shop, state: "HELD", billingDate: { lte: new Date() } } }),
  ]);
  return { ...status, manual: shop.sealManualRenewals, held, due };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent === "disconnect") {
    // Give future held renewals back to Seal first, so they are still charged after disconnecting.
    const client = await getSealClient(session.shop);
    if (client) await releaseSealHolds(session.shop, client).catch(() => undefined);
    await disconnectSeal(session.shop);
    return { ok: true, message: "Seal disconnected" };
  }
  if (intent === "manual") {
    const manual = formData.get("manual") === "on";
    const shop = await ensureShop(session.shop);
    await prisma.shop.update({ where: { id: shop.id }, data: { sealManualRenewals: manual } });
    const client = await getSealClient(session.shop);
    if (!client) return { ok: true, message: "Saved" };
    try {
      if (manual) {
        // Renewals given back to Seal earlier can be held again.
        await prisma.sealHeldAttempt.deleteMany({
          where: { shopDomain: session.shop, state: "RELEASED", billingDate: { gt: new Date() } },
        });
        const result = await holdUpcomingSealRenewals(session.shop, client);
        return { ok: true, message: `Manual renewals on. ${result.held} upcoming renewal${result.held === 1 ? "" : "s"} now wait for approval.` };
      }
      const result = await releaseSealHolds(session.shop, client);
      return {
        ok: result.errors === 0,
        message: `Automatic renewals on. ${result.released} renewal${result.released === 1 ? "" : "s"} given back to Seal.`,
        ...(result.errors ? { error: `${result.errors} renewal(s) could not be given back to Seal. Try again.` } : {}),
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Seal could not be updated" };
    }
  }
  const result = await connectSeal(session.shop, String(formData.get("token") || ""));
  if (!result.ok) return { ok: false, error: result.error };
  let heldMessage = "";
  const shop = await ensureShop(session.shop);
  const client = await getSealClient(session.shop);
  if (shop.sealManualRenewals && client) {
    const held = await holdUpcomingSealRenewals(session.shop, client).catch(() => null);
    if (held) heldMessage = ` ${held.held} upcoming renewal${held.held === 1 ? "" : "s"} now wait for approval.`;
  }
  return {
    ok: true,
    message: `Seal connected. ${result.ruleCount} plan${result.ruleCount === 1 ? "" : "s"} found.${heldMessage}`,
  };
};

export default function SealConnection() {
  const { connected, connectedAt, manual, held, due } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const connectRef = useRef<HTMLFormElement>(null);
  const disconnectRef = useRef<HTMLFormElement>(null);
  const manualRef = useRef<HTMLFormElement>(null);
  const submitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData && "message" in actionData && actionData.message) shopify.toast.show(actionData.message);
    if (actionData && "error" in actionData && actionData.error) shopify.toast.show(actionData.error, { isError: true });
  }, [actionData, shopify]);

  return (
    <s-page heading="Seal Subscriptions">
      {actionData && "error" in actionData && actionData.error ? (
        <s-banner tone="critical">{actionData.error}</s-banner>
      ) : null}

      <s-section heading="Connection">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-text>Status</s-text>
            <s-badge tone={connected ? "success" : "neutral"}>{connected ? "Connected" : "Not connected"}</s-badge>
            {connected && connectedAt ? <s-text color="subdued">since {formatDate(connectedAt)}</s-text> : null}
          </s-stack>
          <s-paragraph>
            If this store uses the Seal Subscriptions app, SubsManager Manga can show and manage its
            subscriptions and plans: pause, resume, skip, cancel, charge now, and send the payment update
            email. Seal keeps billing the subscriptions in the background.
          </s-paragraph>

          <Form method="post" ref={connectRef}>
            <input type="hidden" name="intent" value="connect" />
            <s-stack direction="block" gap="base">
              <s-password-field
                name="token"
                label={connected ? "Replace API token" : "Seal API token"}
                autocomplete="off"
                details="In Seal: Settings → General settings → API. Create a credential with all permissions and copy its API token (not the secret)."
              ></s-password-field>
              <s-button
                variant="primary"
                loading={submitting && navigation.formData?.get("intent") === "connect"}
                onClick={() => connectRef.current?.requestSubmit()}
              >
                {connected ? "Save new token" : "Connect Seal"}
              </s-button>
            </s-stack>
          </Form>
        </s-stack>
      </s-section>

      {connected ? (
        <s-section heading="Renewals">
          <Form method="post" ref={manualRef}>
            <input type="hidden" name="intent" value="manual" />
            <s-stack direction="block" gap="base">
              <s-switch
                name="manual"
                value="on"
                label="Charge renewals manually"
                details="Each renewal waits on the Subscriptions page until you select Charge due renewal. When off, Seal charges renewals automatically on their billing date."
                defaultChecked={manual}
                disabled={submitting}
                onChange={() => manualRef.current?.requestSubmit()}
              ></s-switch>
              {manual ? (
                <s-stack direction="inline" gap="base">
                  <s-badge tone={due ? "warning" : "success"}>{due} due for approval</s-badge>
                  <s-badge tone="info">{held} upcoming on hold</s-badge>
                </s-stack>
              ) : null}
              {manual ? (
                <s-paragraph color="subdued">
                  How it works: SubsManager Manga skips each upcoming renewal in Seal (checked every 10 minutes
                  and whenever you open a subscription), so Seal never charges it on its own. On the billing date
                  it shows as due here. Approving it asks Seal to charge the customer right away. Renewals the
                  customer skipped themselves stay skipped. Turn off Seal’s “order skipped” customer email so
                  customers aren’t told about these holds.
                </s-paragraph>
              ) : null}
              {due ? <s-button href="/app/subscriptions?status=DUE">View due renewals</s-button> : null}
            </s-stack>
          </Form>
        </s-section>
      ) : null}

      {connected ? (
        <s-section heading="Disconnect">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Removes the token from SubsManager Manga. Subscriptions keep running in Seal, and upcoming
              renewals on hold are given back to Seal so it charges them automatically. Renewals that are
              already due stay skipped.
            </s-paragraph>
            <Form method="post" ref={disconnectRef}>
              <input type="hidden" name="intent" value="disconnect" />
              <s-button
                tone="critical"
                loading={submitting && navigation.formData?.get("intent") === "disconnect"}
                onClick={() => {
                  if (window.confirm(due ? `Disconnect Seal? ${due} due renewal(s) have not been charged and will stay skipped.` : "Disconnect Seal from SubsManager Manga?")) disconnectRef.current?.requestSubmit();
                }}
              >
                Disconnect Seal
              </s-button>
            </Form>
          </s-stack>
        </s-section>
      ) : null}

      <s-section slot="aside" heading="Good to know">
        <s-unordered-list>
          <s-list-item>New plans are created in Seal (Subscription rules). You can add products to them from the Plans page here.</s-list-item>
          <s-list-item>With manual renewals on, nothing is charged until you approve it, as long as the app’s scheduled job keeps running.</s-list-item>
          <s-list-item>Turn Seal’s own app embed off if you only want SubsManager Manga’s product-page widget to show.</s-list-item>
          <s-list-item>The token is stored encrypted and removed when the app is uninstalled.</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
