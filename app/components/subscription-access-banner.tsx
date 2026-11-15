/** Shown where subscriptions would appear when the store has not connected Seal yet. */
export function SubscriptionAccessBanner() {
  return (
    <s-banner tone="info" heading="Connect Seal Subscriptions to get started">
      <s-paragraph>
        SubsManager Manga manages subscriptions billed by the Seal Subscriptions app. Install Seal on this
        store, then paste its API token on the <s-link href="/app/seal">Seal page</s-link>.
      </s-paragraph>
    </s-banner>
  );
}
