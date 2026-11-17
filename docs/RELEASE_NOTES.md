# SubsManager Manga — release notes (November 2026)

This release makes every screen and operation work end to end. Renewals stay **manual by design**:
the app never charges a customer on its own.

## Widget page: full control of the product-page widget (new)
A new **Widget** page in the app controls the storefront widget, with a live, clickable preview
(desktop/mobile) that runs the real storefront code:
- **Purchase options:** subscription or one-time, or **subscription only** (the one-time option and the
  subscription radio button are hidden); default selection; order; frequencies as buttons, a list, or a dropdown.
- **Texts:** heading, option names, frequency label, saving text, badge, up to 5 benefits, note.
- **Show or hide:** badge, prices, crossed-out price, benefits, frequency label, savings, note.
- **Colors** (13, most can use the theme's color), **size and spacing** (text size, radius, border width,
  inner spacing, gap, max width, space above/below).
- **Custom code:** an extra CSS class on the widget and a Custom CSS field, with the list of class names.
Settings are saved in the shop metafield, so changes apply to every product page immediately with no
republishing. All values are validated (colors, numbers, class names; "<" is removed from custom CSS).
The theme editor block now only has the product picker (Shopify allows at most 25 settings per app block).
Migration `20261117000000_widget_settings` adds the settings column.

## Billing through Seal Subscriptions (new)
SubsManager Manga now bills through the **Seal Subscriptions** app (which already has Shopify's
subscription access) and no longer depends on Shopify approving its own subscription permissions.
All messages about waiting for that approval were removed; screens that don't apply to Seal (the app's own
customer emails, customer portal and plan creation) are hidden, and the dashboard shows Seal's numbers.
Only the product-page widget extension is published (`extension_directories` in `shopify.app.toml`).
- **Seal page:** paste Seal's API token (Seal → Settings → General settings → API). The token is checked
  with Seal before it is saved, stored encrypted, and deleted when the app is uninstalled.
- **Subscriptions:** lists Seal's subscriptions with search and status filters. Each subscription shows
  products, upcoming orders, charge history, customer and card, with **Pause / Resume, Skip / Restore an
  order, Charge now, Send payment update email, Cancel**. Every action is recorded in the audit log.
- **Plans:** shows Seal's plans (frequency, discount, products) with **Add products** (products already in
  the plan are skipped). New Seal plans are created in Seal, because Seal's API cannot create plans.
- **Dashboard:** shows Seal's active subscriptions and per-cycle revenue.
- The product-page widget shows any plan on a product, including Seal's, so Seal's own app embed can stay off.
- **Manual renewals for Seal (on by default).** Seal has no setting to stop automatic charging, so the app
  holds each upcoming renewal by skipping it in Seal (checked every 10 minutes by the scheduled job, when
  Seal is connected, and whenever a subscription is opened). On the billing date the renewal shows as
  **Due — needs approval** (dashboard, Subscriptions list with a Due filter, and the subscription page).
  **Charge due renewal** asks Seal to charge the subscription now; a double click cannot charge twice and
  a declined charge stays due. Staff can also Skip or Restore a held renewal. Renewals the customer skipped
  themselves are never held. The switch on the Seal page turns this off (future holds are given back to
  Seal) or on again; disconnecting Seal also gives future holds back.
- Migration `20261115010000_seal_manual_renewals` adds the setting and the held-renewals table.
- Migration `20261115000000_seal_connection` adds the token fields and runs automatically on deploy.
- `shopify.app.toml` and `render.yaml` now ask only for the 5 permissions the app uses: read_orders,
  read_products, write_customers, write_products, write_purchase_options.

## Renewals and charging
- **Due detection fixed.** The app used to treat the oldest past billing cycle as "due", so almost every
  subscription showed as due and "Charge due cycle" targeted a cycle that had already been billed. It now
  uses Shopify's billed/unbilled status for each cycle.
- **Charges are idempotent and retryable.** Charges use `subscriptionBillingAttemptCreate` with an
  idempotency key. A declined card can be retried after the customer updates it; a double click, or a cycle
  that is already paid, is refused.
- **Charge history** is shown on every subscription in both the Shopify app and the control center.
- Pending charges are re-checked with Shopify when a page opens, so a delayed webhook never leaves a charge
  stuck as "processing".
- Skipped cycles can be restored.

## Customer emails (new)
Each store controls its emails from **Settings → Customer emails**:
- A master switch turns all customer emails on or off. Individual choices are kept while it is off.
- **Welcome**: sent when someone subscribes.
- **Upcoming renewal reminder**: sent 1–14 days before each billing date (the store chooses).
- **Payment failed**: asks the customer to update their payment method.
- **Paused, resumed, and cancelled confirmations**: covers changes made by customers or staff.
- A reply-to address, a **Send test email** button, and a list of recent emails with their delivery status.

Every email is sent at most once (Shopify webhook retries never cause duplicates). Emails that fail because
the provider is briefly down are retried by the scheduled job. Sending requires `RESEND_API_KEY` and
`SUBSCRIPTION_EMAIL_FROM` on the server. A database migration (`20261114000000_customer_emails`) adds the
settings and runs automatically on deploy.

## Product-page subscription picker (redesigned)
- A card-style picker: "Subscribe & save" with the regular price crossed out, the subscription price,
  and a "Save up to X%" badge.
- Benefit lines with checkmarks (up to three, editable).
- Delivery frequencies shown as buttons, each with its own saving (for example 30 / 45 / 60 days).
- A one-time purchase option. Stores choose which option starts selected and which shows first.
- Every label and color can be changed in the theme editor.
- Plans can now offer **several delivery frequencies**, each with its own discount (Plans → Create/Edit).
- Fixed: on real product forms, the subscription choice could fail to reach the cart. Product forms contain
  a field named `id` that hides the form's own id; the picker now handles this.

## Product page and customer portal switches (new)
In **Settings → Product page and customer portal**, each store can turn off:
- The subscription options on product pages (products that can only be bought as a subscription still
  show them). In the theme editor, the merchant sees a note explaining why the picker is hidden.
- The customer portal's action buttons. Customers still see their subscriptions, plus a "contact us"
  message with the store's reply-to email.
- Individual portal actions: pause/resume, skip, cancel, update payment method.

The settings are published to the store as a shop metafield (`subsmanager.settings`) that the theme block
and the customer-account extensions read. If the store can't be updated, Settings shows a warning and
saving again retries. A database migration (`20261114010000_storefront_settings`) runs automatically on
deploy.

## Data sync and webhooks
- Webhook statuses (`active`, `paused`…) are stored in the uppercase form the rest of the app expects.
  Before this fix, active-subscription counts and analytics stayed at zero.
- Billing results are matched to the correct subscription, and the order total is recorded, so renewal
  revenue now appears in analytics.
- New and updated subscriptions load the customer name, products and next billing date from Shopify.
- Webhooks are recorded only after processing succeeds, so a failure is retried by Shopify instead of lost.
- The scheduled job and "Synchronize Shopify" sync **all** subscriptions (previously only the latest 50) and
  find due renewals correctly. Shopify does not support a billing-date search filter, which the old code relied on.
- A store's existing subscriptions are imported right after install.
- Uninstalling the app keeps the store's settings and history (deleted 48 hours later by Shopify's
  `shop/redact` webhook, as Shopify requires).

## Shopify admin app
- "Create plan" and "Save changes" now submit (the header buttons were outside the form).
- Subscription search and the "Due" filter work (Shopify only filters by status; the rest happens in the app).
- Subscription list pagination.
- Cancelling asks for confirmation.
- Analytics no longer show `$NaN`.
- Branding is consistently "SubsManager Manga".

## Control center (/control)
- **JavaScript was blocked by the security policy**, so confirmations, loading states and several forms did
  not work, and some submissions failed with "Bad Request". Scripts are now allowed through a per-request
  nonce, and the policy is otherwise as strict as before.
- Two-factor setup shows a scannable QR code.
- Admins can no longer accidentally demote or deactivate other admins, and staff cannot change their own role.
- Sign out is available on phones.
- Clear messages when a store is disconnected; the last synced products and totals are still shown.

## Customer portal and storefront
- Customers can cancel again. The portal used `confirm()`, which does not exist in Shopify extensions, so
  the Cancel button failed silently. It now uses an in-page confirmation. The same fix applies to "Remove
  purchase option" in the product admin.
- All three UI extensions failed to build (`@preact/signals` was missing), which would have blocked
  `shopify app deploy`.
- The product-page subscription picker finds the add-to-cart form on any theme, not only Dawn. Before, the
  chosen plan was silently dropped on other themes.
- Options that should be hidden are hidden again (the stylesheet overrode `hidden`).
- Subscription-only products hide the one-time purchase option.
- Editing a purchase option and setting the discount to 0% now removes the old discount.

## Verified
- TypeScript, ESLint, and a production build pass.
- All 26 Admin GraphQL operations validate against Shopify's 2026-07 schema.
- Theme Check passes; all UI extensions type-check and bundle.
- Control center tested in a browser: login, lockout message, MFA setup and sign-in, every page, team
  management, role permissions, and phone layout.
- Webhooks tested with signed requests: valid, duplicate, and bad signature.
- Charge flow tested against a simulated Shopify: due cycle, double click, decline then retry, and an
  already-billed cycle.
- Emails tested against simulated Shopify and email services: each email type, the master and
  individual switches, no duplicates, the reminder window, outage then retry, and the test email.
