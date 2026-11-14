import "@shopify/ui-extensions/preact";
import {render} from "preact";
import {useEffect, useState} from "preact/hooks";
import {ORDER_CONTRACTS_QUERY, SETTINGS_QUERY, customerGraphql} from "./graphql";

type OrderData = {order?: {subscriptionContracts: {nodes: {id: string; status: string}[]}}};

const api = shopify;

export default async () => {
  render(<OrderStatusBlock />, document.body);
};

function OrderStatusBlock() {
  const orderId = api.order.value?.id;
  const [hasSubscription, setHasSubscription] = useState(false);
  const [portalEnabled, setPortalEnabled] = useState(true);

  useEffect(() => {
    void customerGraphql<{shop: {metafield: {value: string} | null}}>(SETTINGS_QUERY)
      .then((data) => {
        const parsed = JSON.parse(data.shop.metafield?.value || "{}") as {portal?: {enabled?: boolean}};
        setPortalEnabled(parsed.portal?.enabled !== false);
      })
      .catch(() => setPortalEnabled(true));
  }, []);

  useEffect(() => {
    if (!orderId) return;
    void customerGraphql<OrderData>(ORDER_CONTRACTS_QUERY, {orderId})
      .then((data) =>
        setHasSubscription(
          Boolean(data.order?.subscriptionContracts.nodes.some(({status}) => status !== "CANCELLED")),
        ),
      )
      .catch(() => setHasSubscription(false));
  }, [orderId]);

  if (!hasSubscription) return null;

  return (
    <s-banner heading="This order includes a subscription">
      <s-stack direction="block" gap="base">
        <s-text>
          {portalEnabled
            ? "Review upcoming orders and manage your subscription from your account."
            : "You can see your subscription details in your account."}
        </s-text>
        <s-button onClick={() => navigation.navigate("extension://subsmanager-customer-portal")}>
          {portalEnabled ? "Manage subscription" : "View subscription"}
        </s-button>
      </s-stack>
    </s-banner>
  );
}
