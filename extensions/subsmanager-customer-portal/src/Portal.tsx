import "@shopify/ui-extensions/preact";
import {render} from "preact";
import {useEffect, useState} from "preact/hooks";
import {
  ACTIVATE_CONTRACT,
  CANCEL_CONTRACT,
  CONTRACTS_QUERY,
  DEFAULT_SETTINGS,
  PAUSE_CONTRACT,
  SKIP_BILLING_CYCLE,
  customerGraphql,
  loadPortalSettings,
} from "./graphql";
import type {PortalSettings} from "./graphql";

type Money = {amount: string; currencyCode: string};
type Contract = {
  id: string;
  status: string;
  lastBillingAttemptErrorType?: string;
  currencyCode: string;
  deliveryPolicy: {interval: string; intervalCount: {count: number}};
  upcomingBillingCycles: {nodes: {billingAttemptExpectedDate: string; skipped: boolean; cycleIndex: number}[]};
  orders: {nodes: {id: string; totalPrice: Money}[]};
  lines: {nodes: {id: string; name: string; title: string; variantTitle?: string; quantity: number; image?: {url: string; altText?: string}; lineDiscountedPrice: Money}[]};
};

type ContractsData = {customer: {subscriptionContracts: {nodes: Contract[]}}};

const api = shopify;

export default async () => {
  render(<Portal />, document.body);
};

function Portal() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [confirmingCancel, setConfirmingCancel] = useState("");
  const [settings, setSettings] = useState<PortalSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    void loadPortalSettings().then(setSettings);
    void loadContracts();
  }, []);

  async function loadContracts() {
    setError("");
    try {
      const data = await customerGraphql<ContractsData>(CONTRACTS_QUERY, {first: 50});
      setContracts(data.customer.subscriptionContracts.nodes);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Subscriptions could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  async function changeStatus(contract: Contract, action: "pause" | "resume" | "cancel") {
    // Extensions run in a sandbox without window.confirm, so cancellation uses a second click.
    if (action === "cancel" && confirmingCancel !== contract.id) {
      setConfirmingCancel(contract.id);
      return;
    }
    setConfirmingCancel("");
    setBusyId(contract.id);
    setError("");
    const mutation = action === "pause" ? PAUSE_CONTRACT : action === "resume" ? ACTIVATE_CONTRACT : CANCEL_CONTRACT;
    try {
      const data = await customerGraphql<Record<string, {userErrors?: {message: string}[]}>>(mutation, {
        subscriptionContractId: contract.id,
      });
      const payload = Object.values(data)[0];
      if (payload?.userErrors?.length) throw new Error(payload.userErrors.map(({message}) => message).join(" "));
      api.toast.show(action === "pause" ? "Subscription paused" : action === "resume" ? "Subscription resumed" : "Subscription cancelled");
      await loadContracts();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "The subscription could not be updated.");
    } finally {
      setBusyId("");
    }
  }

  async function replacePaymentMethod(contractId: string) {
    setBusyId(contractId);
    setError("");
    try {
      const activity = await api.intents.invoke({
        action: "open",
        type: "shopify/SubscriptionContract",
        value: contractId,
        data: {field: "paymentMethod"},
      });
      const result = await activity.complete;
      if (result.code === "ok") api.toast.show("Payment method updated");
    } catch (intentError) {
      setError(intentError instanceof Error ? intentError.message : "The payment method flow could not be opened.");
    } finally {
      setBusyId("");
    }
  }

  async function skipNextOrder(contract: Contract) {
    const nextCycle = contract.upcomingBillingCycles.nodes.find(({skipped}) => !skipped);
    if (!nextCycle) return;
    setBusyId(contract.id);
    setError("");
    try {
      const data = await customerGraphql<{
        subscriptionBillingCycleSkip: {userErrors?: {message: string}[]};
      }>(SKIP_BILLING_CYCLE, {
        billingCycleInput: {
          contractId: contract.id,
          selector: {index: nextCycle.cycleIndex},
        },
      });
      const errors = data.subscriptionBillingCycleSkip.userErrors || [];
      if (errors.length) throw new Error(errors.map(({message}) => message).join(" "));
      api.toast.show("Next order skipped");
      await loadContracts();
    } catch (skipError) {
      setError(skipError instanceof Error ? skipError.message : "The next order could not be skipped.");
    } finally {
      setBusyId("");
    }
  }

  if (loading) {
    return (
      <s-page heading="Subscriptions">
        <s-stack alignItems="center" padding="large-500"><s-spinner accessibilityLabel="Loading subscriptions" /></s-stack>
      </s-page>
    );
  }

  return (
    <s-page heading="Subscriptions">
      <s-stack direction="block" gap="base">
        {error ? <s-banner tone="critical" heading="We couldn't complete that request">{error}</s-banner> : null}
        {!settings.enabled && contracts.length > 0 ? (
          <s-banner heading="Need to change your subscription?">
            {settings.supportEmail
              ? `Contact us at ${settings.supportEmail} and we'll take care of it.`
              : "Contact the store and they'll take care of it."}
          </s-banner>
        ) : null}
        {contracts.length === 0 ? (
          <s-section heading="No subscriptions yet">
            <s-stack direction="block" gap="base">
              <s-text>Your active and past subscriptions will appear here after you subscribe to a product.</s-text>
              <s-button onClick={() => navigation.navigate("shopify:customer-account/orders")}>View orders</s-button>
            </s-stack>
          </s-section>
        ) : (
          contracts.map((contract) => (
            <ContractCard
              key={contract.id}
              contract={contract}
              busy={busyId === contract.id}
              confirmingCancel={confirmingCancel === contract.id}
              settings={settings}
              onKeep={() => setConfirmingCancel("")}
              onStatus={changeStatus}
              onPayment={replacePaymentMethod}
              onSkip={skipNextOrder}
            />
          ))
        )}
      </s-stack>
    </s-page>
  );
}

function ContractCard({
  contract,
  busy,
  confirmingCancel,
  settings,
  onKeep,
  onStatus,
  onPayment,
  onSkip,
}: {
  contract: Contract;
  busy: boolean;
  confirmingCancel: boolean;
  settings: PortalSettings;
  onKeep: () => void;
  onStatus: (contract: Contract, action: "pause" | "resume" | "cancel") => void;
  onPayment: (id: string) => void;
  onSkip: (contract: Contract) => void;
}) {
  const nextCycle = contract.upcomingBillingCycles.nodes.find(({skipped}) => !skipped);
  const total = contract.orders.nodes[0]?.totalPrice;
  const interval = contract.deliveryPolicy;
  const intervalText = `Every ${interval.intervalCount.count} ${interval.interval.toLowerCase()}${interval.intervalCount.count === 1 ? "" : "s"}`;
  const tone = contract.status === "CANCELLED" || contract.status === "FAILED" ? "critical" : contract.status === "ACTIVE" ? "auto" : "neutral";

  return (
    <s-section>
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" justifyContent="space-between" alignItems="center">
          <s-stack direction="block" gap="small-100">
            <s-heading>{contract.lines.nodes[0]?.title || "Subscription"}</s-heading>
            <s-text color="subdued">{intervalText}</s-text>
          </s-stack>
          <s-badge tone={tone}>{titleCase(contract.status)}</s-badge>
        </s-stack>
        {contract.lastBillingAttemptErrorType ? (
          <s-banner tone="warning" heading="Payment needs attention">
            {settings.enabled && settings.payment
              ? "Update your payment method so the next recurring order can be processed."
              : settings.supportEmail
                ? `Contact us at ${settings.supportEmail} to update your payment method.`
                : "Contact the store to update your payment method."}
          </s-banner>
        ) : null}
        <s-stack direction="block" gap="small-200">
          {contract.lines.nodes.map((line) => (
            <s-grid key={line.id} gridTemplateColumns={line.image ? "64px 1fr auto" : "1fr auto"} gap="base" alignItems="center">
              {line.image ? <s-image src={line.image.url} alt={line.image.altText || line.title} borderRadius="base" aspectRatio="1" /> : null}
              <s-stack direction="block" gap="small-100">
                <s-text type="strong">{line.name}</s-text>
                <s-text color="subdued">Quantity {line.quantity}</s-text>
              </s-stack>
              <s-text>{money(line.lineDiscountedPrice)}</s-text>
            </s-grid>
          ))}
        </s-stack>
        <s-divider />
        <s-grid gridTemplateColumns="repeat(2, minmax(0, 1fr))" gap="base">
          <s-stack direction="block" gap="small-100">
            <s-text color="subdued">Next order</s-text>
            <s-text type="strong">{nextCycle ? date(nextCycle.billingAttemptExpectedDate) : "Not scheduled"}</s-text>
          </s-stack>
          <s-stack direction="block" gap="small-100">
            <s-text color="subdued">Last order total</s-text>
            <s-text type="strong">{total ? money(total) : "—"}</s-text>
          </s-stack>
        </s-grid>
        {settings.enabled ? (
          <s-stack direction="inline" gap="small-200">
            {settings.payment ? (
              <s-button disabled={busy || contract.status === "CANCELLED" || contract.status === "EXPIRED"} onClick={() => onPayment(contract.id)}>Update payment</s-button>
            ) : null}
            {settings.skip && nextCycle && contract.status === "ACTIVE" ? (
              <s-button disabled={busy} onClick={() => onSkip(contract)}>Skip next order</s-button>
            ) : null}
            {settings.pause && contract.status === "ACTIVE" ? (
              <s-button disabled={busy} onClick={() => onStatus(contract, "pause")}>Pause</s-button>
            ) : settings.pause && contract.status === "PAUSED" ? (
              <s-button variant="primary" disabled={busy} onClick={() => onStatus(contract, "resume")}>Resume</s-button>
            ) : null}
            {settings.cancel && contract.status !== "CANCELLED" && contract.status !== "EXPIRED" && !confirmingCancel ? (
              <s-button tone="critical" disabled={busy} onClick={() => onStatus(contract, "cancel")}>Cancel subscription</s-button>
            ) : null}
          </s-stack>
        ) : null}
        {settings.enabled && !settings.cancel && contract.status !== "CANCELLED" && contract.status !== "EXPIRED" ? (
          <s-text color="subdued">
            {settings.supportEmail ? `To cancel, contact us at ${settings.supportEmail}.` : "To cancel, contact the store."}
          </s-text>
        ) : null}
        {confirmingCancel ? (
          <s-banner tone="warning" heading="Cancel this subscription?">
            <s-stack direction="block" gap="base">
              <s-text>Future recurring orders will stop. This can't be undone from your account.</s-text>
              <s-stack direction="inline" gap="small-200">
                <s-button tone="critical" variant="primary" disabled={busy} onClick={() => onStatus(contract, "cancel")}>
                  Yes, cancel subscription
                </s-button>
                <s-button disabled={busy} onClick={onKeep}>Keep subscription</s-button>
              </s-stack>
            </s-stack>
          </s-banner>
        ) : null}
      </s-stack>
    </s-section>
  );
}

function money(value: Money) {
  return new Intl.NumberFormat(undefined, {style: "currency", currency: value.currencyCode}).format(Number(value.amount));
}

function date(value: string) {
  return new Intl.DateTimeFormat(undefined, {dateStyle: "medium"}).format(new Date(value));
}

function titleCase(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
