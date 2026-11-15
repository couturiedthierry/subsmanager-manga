/** Shown wherever subscription data would appear while Shopify's approval is pending. */
export function SubscriptionAccessBanner() {
  return (
    <s-banner tone="warning" heading="Waiting for Shopify to approve subscription access">
      <s-paragraph>
        Shopify must approve this app’s subscription permissions before it can show or manage
        subscriptions. Until then you can still create plans, set up the product page, and adjust
        settings.
      </s-paragraph>
      <s-paragraph>
        To request approval: in the Shopify Partner Dashboard, open Apps, choose this app, then API
        access requests, and request access on the Subscription APIs card. After approval, add the
        subscription permissions to the app and open it again.
      </s-paragraph>
    </s-banner>
  );
}
