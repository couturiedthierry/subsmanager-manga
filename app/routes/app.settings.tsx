import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getShopSettings, updateShopSettings } from "../models/shop.server";
import { syncStorefrontSettings } from "../models/storefront-settings.server";
import { emailConfigured as isEmailConfigured, recentEmails, sendTestEmail } from "../lib/subscription-email.server";
import { hasSubscriptionAccess, REQUIRED_SCOPES } from "../lib/access.server";
import { sealConnectionStatus } from "../models/seal-connection.server";

function hasGrantedScope(grantedScopes: Set<string>, requiredScope: string) {
  if (grantedScopes.has(requiredScope)) return true;

  if (requiredScope.startsWith("customer_read_")) {
    return grantedScopes.has(requiredScope.replace("customer_read_", "customer_write_"));
  }

  if (requiredScope.startsWith("read_")) {
    return grantedScopes.has(requiredScope.replace("read_", "write_"));
  }

  return false;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getShopSettings(session.shop);
  const requiredScopes = REQUIRED_SCOPES;
  const grantedScopes = new Set(
    (session.scope || "")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
  );
  return {
    settings,
    apiKey: process.env.SHOPIFY_API_KEY || "",
    emailConfigured: isEmailConfigured(),
    emails: await recentEmails(session.shop),
    missingScopes: requiredScopes.filter((scope) => !hasGrantedScope(grantedScopes, scope)),
    sealMode: !hasSubscriptionAccess(session.scope),
    sealConnected: (await sealConnectionStatus(session.shop)).connected,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();

  if (formData.get("intent") === "test-email") {
    const to = String(formData.get("testEmail") || "").trim();
    if (!/^\S+@\S+\.\S+$/.test(to)) return { ok: false, error: "Enter a valid email address for the test" };
    try {
      const result = await sendTestEmail(session.shop, to);
      if (!result.sent) {
        return {
          ok: false,
          error: result.reason === "not-configured"
            ? "Email sending is not set up on the server yet (RESEND_API_KEY and SUBSCRIPTION_EMAIL_FROM)."
            : "The test email could not be sent",
        };
      }
      return { ok: true, message: `Test email sent to ${to}` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "The test email could not be sent" };
    }
  }

  const dunningRetries = Number(formData.get("dunningRetries") || 3);
  const retryIntervalDays = Number(formData.get("retryIntervalDays") || 3);
  const supportEmail = String(formData.get("supportEmail") || "").trim() || null;

  if (!Number.isInteger(dunningRetries) || dunningRetries < 0 || dunningRetries > 10) {
    return { ok: false, error: "Retry attempts must be between 0 and 10" };
  }
  if (!Number.isInteger(retryIntervalDays) || retryIntervalDays < 1 || retryIntervalDays > 30) {
    return { ok: false, error: "Retry interval must be between 1 and 30 days" };
  }

  const reminderDaysBefore = Number(formData.get("reminderDaysBefore") || 3);
  if (!Number.isInteger(reminderDaysBefore) || reminderDaysBefore < 1 || reminderDaysBefore > 14) {
    return { ok: false, error: "Send renewal reminders between 1 and 14 days before the billing date" };
  }
  const emailsEnabled = formData.get("emailsEnabled") === "on";
  // While the master switch is off the individual switches are disabled and not submitted,
  // so keep their saved values instead of turning them all off.
  const emailChoices = emailsEnabled
    ? {
        emailWelcome: formData.get("emailWelcome") === "on",
        emailRenewalReminder: formData.get("emailRenewalReminder") === "on",
        reminderDaysBefore,
        emailPaymentFailed: formData.get("emailPaymentFailed") === "on",
        emailStatusChange: formData.get("emailStatusChange") === "on",
      }
    : {};

  const portalEnabled = formData.get("portalEnabled") === "on";
  // Disabled switches are not submitted, so keep the saved actions while the portal is off.
  const portalChoices = portalEnabled
    ? {
        portalAllowPause: formData.get("portalAllowPause") === "on",
        portalAllowSkip: formData.get("portalAllowSkip") === "on",
        portalAllowCancel: formData.get("portalAllowCancel") === "on",
        portalAllowPayment: formData.get("portalAllowPayment") === "on",
      }
    : {};

  // In Seal mode the email and portal sections are hidden (Seal handles both), so keep their saved values.
  const sealMode = !hasSubscriptionAccess(session.scope);
  const saved = await updateShopSettings(session.shop, {
    showProductWidget: formData.get("showProductWidget") === "on",
    ...(sealMode ? {} : { portalEnabled, ...portalChoices, emailsEnabled, ...emailChoices, supportEmail }),
    dunningRetries,
    retryIntervalDays,
    cancelAfterFailures: formData.get("cancelAfterFailures") === "on",
    onboardingComplete: formData.get("onboardingComplete") === "on",
  });
  const published = await syncStorefrontSettings(saved, admin);
  if (!published.ok) {
    return {
      ok: false,
      error: `Settings saved, but the storefront could not be updated yet: ${published.error}`,
    };
  }
  return { ok: true, message: "Settings saved" };
};

const EMAIL_LABELS: Record<string, string> = {
  SUBSCRIPTION_WELCOME: "Welcome",
  RENEWAL_REMINDER: "Renewal reminder",
  PAYMENT_FAILED: "Payment failed",
  STATUS_CHANGE: "Status change",
  TEST: "Test email",
};

export default function Settings() {
  const { settings, apiKey, emailConfigured, emails, missingScopes, sealMode, sealConnected } = useLoaderData<typeof loader>();
  const [emailsOn, setEmailsOn] = useState(settings.emailsEnabled);
  const [portalOn, setPortalOn] = useState(settings.portalEnabled);
  const testFetcher = useFetcher<typeof action>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const formRef = useRef<HTMLFormElement>(null);
  const productEditorUrl = apiKey
    ? `shopify://admin/themes/current/editor?template=product&addAppBlockId=${apiKey}/subscription-selector&target=mainSection`
    : "shopify://admin/themes/current/editor?context=apps&template=product";
  const cartEditorUrl = apiKey
    ? `shopify://admin/themes/current/editor?template=cart&addAppBlockId=${apiKey}/subscription-cart-details&target=mainSection`
    : "shopify://admin/themes/current/editor?context=apps&template=cart";

  useEffect(() => {
    if (actionData?.message) shopify.toast.show(actionData.message);
    if (actionData?.error) shopify.toast.show(actionData.error, { isError: true });
  }, [actionData, shopify]);

  useEffect(() => {
    if (testFetcher.state !== "idle" || !testFetcher.data) return;
    if (testFetcher.data.message) shopify.toast.show(testFetcher.data.message);
    if (testFetcher.data.error) shopify.toast.show(testFetcher.data.error, { isError: true });
  }, [testFetcher.data, testFetcher.state, shopify]);

  return (
    <s-page heading="Settings">
      <Form method="post" ref={formRef}>
        <s-stack direction="block" gap="base">
          {actionData?.error && <s-banner tone="critical">{actionData.error}</s-banner>}
          {sealMode ? (
            <s-banner tone="info" heading={sealConnected ? "Seal handles customer emails and the customer portal" : "Connect Seal Subscriptions"}>
              {sealConnected
                ? "Seal sends the subscription emails to customers and gives them their manage-subscription portal. Set those up in Seal → Settings. The product page switch below still controls the SubsManager Manga widget."
                : "Subscriptions are billed by the Seal Subscriptions app. Connect it on the Seal page first."}
            </s-banner>
          ) : null}

          <s-section heading="Renewals and failed payments">
            <s-stack direction="block" gap="base">
              {sealMode ? (
                <s-banner tone="info">
                  Renewals are billed by Seal Subscriptions. With manual renewals on (on the{" "}
                  <s-link href="/app/seal">Seal page</s-link>), each renewal shows as due on its billing date and is
                  charged only when you select Charge due renewal.
                </s-banner>
              ) : (
                <s-banner tone="info">
                  Renewals are never charged automatically. When a billing date passes, the subscription
                  shows as due. After the customer approves, open it and select Charge due cycle.
                </s-banner>
              )}
              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-number-field
                  name="dunningRetries"
                  label="Customer follow-up attempts"
                  defaultValue={String(settings.dunningRetries)}
                  min={0}
                  max={10}
                  details="Internal guidance after a customer-approved charge fails."
                ></s-number-field>
                <s-number-field
                  name="retryIntervalDays"
                  label="Days between follow-ups"
                  defaultValue={String(settings.retryIntervalDays)}
                  min={1}
                  max={30}
                ></s-number-field>
              </s-grid>
              <s-paragraph color="subdued">
                These values are a guide for your team when following up on failed payments.
                SubsManager Manga never retries, charges, or cancels a subscription on its own.
              </s-paragraph>
            </s-stack>
          </s-section>

          {!sealMode ? (
          <s-section heading="Customer emails">
            <s-stack direction="block" gap="base">
              {!emailConfigured ? (
                <s-banner tone="warning" heading="Email sending is not set up yet">
                  Your switches are saved, but no emails go out until the server has an email provider
                  key (RESEND_API_KEY and SUBSCRIPTION_EMAIL_FROM in the hosting settings).
                </s-banner>
              ) : null}
              <s-switch
                name="emailsEnabled"
                value="on"
                label="Send subscription emails to customers"
                details="Turn this off to stop every email below at once. Your individual choices are kept."
                defaultChecked={settings.emailsEnabled}
                onChange={(event) => setEmailsOn(event.currentTarget.checked)}
              ></s-switch>
              <s-divider></s-divider>
              <s-switch
                name="emailWelcome"
                value="on"
                label="Welcome email"
                details="When someone subscribes, with a link to manage their subscription."
                defaultChecked={settings.emailWelcome}
                disabled={!emailsOn}
              ></s-switch>
              <s-switch
                name="emailRenewalReminder"
                value="on"
                label="Upcoming renewal reminder"
                details="A few days before each billing date, so customers can skip, pause, or update their card."
                defaultChecked={settings.emailRenewalReminder}
                disabled={!emailsOn}
              ></s-switch>
              <s-number-field
                name="reminderDaysBefore"
                label="Days before the billing date"
                defaultValue={String(settings.reminderDaysBefore)}
                min={1}
                max={14}
                disabled={!emailsOn}
              ></s-number-field>
              <s-switch
                name="emailPaymentFailed"
                value="on"
                label="Payment failed"
                details="Asks the customer to update their payment method when a charge is declined."
                defaultChecked={settings.emailPaymentFailed}
                disabled={!emailsOn}
              ></s-switch>
              <s-switch
                name="emailStatusChange"
                value="on"
                label="Paused, resumed, and cancelled confirmations"
                details="Confirms changes made by the customer or by your team."
                defaultChecked={settings.emailStatusChange}
                disabled={!emailsOn}
              ></s-switch>
              <s-divider></s-divider>
              <s-email-field
                name="supportEmail"
                label="Reply-to email"
                defaultValue={settings.supportEmail || ""}
                placeholder="subscriptions@example.com"
                autocomplete="email"
                details="Customers who reply to subscription emails reach this address."
              ></s-email-field>
            </s-stack>
          </s-section>
          ) : null}

          <s-section heading={sealMode ? "Product page" : "Product page and customer portal"}>
            <s-stack direction="block" gap="base">
              {settings.storefrontSyncError ? (
                <s-banner tone="warning" heading="Your storefront is not up to date">
                  The last save could not be published to your store ({settings.storefrontSyncError}). Save
                  again to retry.
                </s-banner>
              ) : null}
              <s-switch
                name="showProductWidget"
                value="on"
                label="Show subscription options on product pages"
                details="When off, the subscription picker is hidden and products sell as one-time purchases. Products that can only be bought as a subscription still show it."
                defaultChecked={settings.showProductWidget}
              ></s-switch>
              {!sealMode ? (
                <>
              <s-divider></s-divider>
              <s-switch
                name="portalEnabled"
                value="on"
                label="Let customers manage subscriptions from their account"
                details="When off, the subscriptions page shows their subscriptions with your reply-to email instead of action buttons."
                defaultChecked={settings.portalEnabled}
                onChange={(event) => setPortalOn(event.currentTarget.checked)}
              ></s-switch>
              <s-stack direction="block" gap="small">
                <s-text color="subdued">Customers can:</s-text>
                <s-switch name="portalAllowPause" value="on" label="Pause and resume" defaultChecked={settings.portalAllowPause} disabled={!portalOn}></s-switch>
                <s-switch name="portalAllowSkip" value="on" label="Skip their next order" defaultChecked={settings.portalAllowSkip} disabled={!portalOn}></s-switch>
                <s-switch name="portalAllowCancel" value="on" label="Cancel" details="Turn off to have customers contact you to cancel." defaultChecked={settings.portalAllowCancel} disabled={!portalOn}></s-switch>
                <s-switch name="portalAllowPayment" value="on" label="Update their payment method" defaultChecked={settings.portalAllowPayment} disabled={!portalOn}></s-switch>
              </s-stack>
                </>
              ) : null}
            </s-stack>
          </s-section>

          <s-section heading="Install on your store">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                {sealMode
                  ? "Add the subscription selector to your product template and subscription details to the cart. Turn off Seal’s own app embed so only this widget shows."
                  : "Add the purchase selector to product templates and subscription details to the cart, then add SubsManager Manga’s subscription page to customer accounts so buyers can manage every contract without contacting staff."}
              </s-paragraph>
              <s-button-group>
                <s-button href={productEditorUrl} variant="primary">Add product selector</s-button>
                <s-button href={cartEditorUrl}>Add cart details</s-button>
                {!sealMode ? <s-button href="shopify://admin/settings/customer_accounts">Set up customer portal</s-button> : null}
              </s-button-group>
              {!sealMode ? (
              <s-banner tone="info" heading="Customer portal activation">
                In Customer accounts, choose Customize, add SubsManager Manga’s Manage subscriptions app page,
                and add it to the customer-account header menu. In the checkout and accounts editor,
                also add SubsManager Manga’s subscription block to Order status. Publishing the app version alone
                does not activate these merchant-controlled placements.
              </s-banner>
              ) : null}
              <s-checkbox
                name="onboardingComplete"
                value="on"
                label={sealMode
                  ? "I installed and tested the product selector and cart details"
                  : "I installed and tested the product selector, cart details, customer portal, and order-status block"}
                defaultChecked={settings.onboardingComplete}
              ></s-checkbox>
            </s-stack>
          </s-section>

          <s-button
            variant="primary"
            loading={navigation.state === "submitting"}
            onClick={() => formRef.current?.requestSubmit()}
          >
            Save settings
          </s-button>
        </s-stack>
      </Form>

      <s-section slot="aside" heading="Data protection">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" justifyContent="space-between">
            <s-text>Payment card data</s-text>
            <s-badge tone="success">Stored by Shopify</s-badge>
          </s-stack>
          <s-stack direction="inline" justifyContent="space-between">
            <s-text>Privacy webhooks</s-text>
            <s-badge tone="success">Configured</s-badge>
          </s-stack>
          <s-stack direction="inline" justifyContent="space-between">
            <s-text>API version</s-text>
            <s-badge tone="info">2026-07</s-badge>
          </s-stack>
          {!sealMode ? (
          <s-stack direction="inline" justifyContent="space-between">
            <s-text>Customer emails</s-text>
            <s-badge tone={!emailConfigured ? "warning" : settings.emailsEnabled ? "success" : "neutral"}>
              {!emailConfigured ? "Setup required" : settings.emailsEnabled ? "On" : "Off"}
            </s-badge>
          </s-stack>
          ) : (
            <s-stack direction="inline" justifyContent="space-between">
              <s-text>Seal Subscriptions</s-text>
              <s-badge tone={sealConnected ? "success" : "warning"}>{sealConnected ? "Connected" : "Not connected"}</s-badge>
            </s-stack>
          )}
        </s-stack>
      </s-section>

      {!sealMode ? (
        <>
      <s-section slot="aside" heading="Send a test email">
        <testFetcher.Form method="post">
          <input type="hidden" name="intent" value="test-email" />
          <s-stack direction="block" gap="base">
            <s-email-field
              name="testEmail"
              label="Send to"
              defaultValue={settings.supportEmail || ""}
              placeholder="you@example.com"
            ></s-email-field>
            <s-button
              loading={testFetcher.state !== "idle"}
              onClick={(event) => (event.currentTarget as HTMLElement).closest("form")?.requestSubmit()}
            >
              Send test email
            </s-button>
          </s-stack>
        </testFetcher.Form>
      </s-section>

      <s-section slot="aside" heading="Recent customer emails">
        {emails.length === 0 ? (
          <s-paragraph color="subdued">No customer emails have been sent yet.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="small">
            {emails.map((email) => (
              <s-stack key={email.id} direction="inline" justifyContent="space-between" gap="small">
                <s-stack direction="block" gap="small-100">
                  <s-text>{EMAIL_LABELS[email.type] || email.type}</s-text>
                  <s-text color="subdued">{email.recipient || "—"}</s-text>
                </s-stack>
                <s-badge tone={email.status === "SENT" ? "success" : email.status === "FAILURE" ? "critical" : "neutral"}>
                  {email.status === "SENT" ? "Sent" : email.status === "FAILURE" ? "Failed" : email.status === "SKIPPED" ? "No email address" : email.status}
                </s-badge>
              </s-stack>
            ))}
          </s-stack>
        )}
      </s-section>
        </>
      ) : null}

      <s-section slot="aside" heading="App updates">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" justifyContent="space-between">
            <s-text>Required permissions</s-text>
            <s-badge tone={missingScopes.length ? "warning" : "success"}>
              {missingScopes.length ? "Update needed" : "Up to date"}
            </s-badge>
          </s-stack>
          {missingScopes.length ? (
            <>
              <s-paragraph color="subdued">
                Reopen SubsManager Manga from Shopify Admin and accept the permission prompt to grant these
                permissions; do not uninstall the app.
              </s-paragraph>
              <s-unordered-list>
                {missingScopes.map((scope) => <s-list-item key={scope}>{scope}</s-list-item>)}
              </s-unordered-list>
            </>
          ) : (
            <s-paragraph color="subdued">
              This installation already has every permission required by the current release.
            </s-paragraph>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
