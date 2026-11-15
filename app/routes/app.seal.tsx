// Connect SubsManager Manga to the Seal Subscriptions API.
import { useEffect, useRef } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { formatDate } from "../lib/format";
import { connectSeal, disconnectSeal, sealConnectionStatus } from "../models/seal-connection.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return sealConnectionStatus(session.shop);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  if (formData.get("intent") === "disconnect") {
    await disconnectSeal(session.shop);
    return { ok: true, message: "Seal disconnected" };
  }
  const result = await connectSeal(session.shop, String(formData.get("token") || ""));
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    message: `Seal connected. ${result.ruleCount} plan${result.ruleCount === 1 ? "" : "s"} found.`,
  };
};

export default function SealConnection() {
  const { connected, connectedAt } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const connectRef = useRef<HTMLFormElement>(null);
  const disconnectRef = useRef<HTMLFormElement>(null);
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
        <s-section heading="Disconnect">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Removes the token from SubsManager Manga. Subscriptions keep running in Seal.
            </s-paragraph>
            <Form method="post" ref={disconnectRef}>
              <input type="hidden" name="intent" value="disconnect" />
              <s-button
                tone="critical"
                loading={submitting && navigation.formData?.get("intent") === "disconnect"}
                onClick={() => {
                  if (window.confirm("Disconnect Seal from SubsManager Manga?")) disconnectRef.current?.requestSubmit();
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
          <s-list-item>Seal charges renewals automatically on each billing date.</s-list-item>
          <s-list-item>Turn Seal’s own app embed off if you only want SubsManager Manga’s product-page widget to show.</s-list-item>
          <s-list-item>The token is stored encrypted and removed when the app is uninstalled.</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
