# SubsManager Manga

SubsManager Manga is a Shopify subscription-management platform built on Shopify's React Router app template. It includes both an embedded merchant app and a separate, Recharge-style control center for operating every connected store from your own website.

The app does not implement a payment gateway or collect raw card details. Shopify Checkout creates the original subscription and Shopify vaults the payment method.

## Included

- Embedded merchant dashboard using Polaris web components
- Selling-plan creation from the app and from product/variant Admin pages
- Subscription list, search, details, pause, resume, cancel, skip, customer-approved due-cycle charging, and payment-update email actions
- Projected recurring revenue, billing-attempt analytics, and operational health views
- Customer Account full-page extension with pause, resume, skip, cancel, and Shopify's native payment-method replacement intent
- Order-status block linking buyers to subscription management
- Idempotent post-purchase portal email through Resend
- Cart app block that displays the selected Shopify selling-plan name
- Theme app block showing one-time and subscription prices, delivery timing, savings, and renewal terms
- Authenticated, idempotent subscription, billing-attempt, selling-plan, uninstall, scope, and privacy webhooks
- Protected due-cycle synchronization job secured by `JOB_SECRET`; it never charges automatically
- External multi-store control center at `/control`
- Staff accounts with owner, admin, support, and viewer roles
- Mandatory MFA for owners and admins, encrypted sessions, CSRF protection, login lockouts, and an audit trail
- Live store synchronization and protected support, billing, and cancellation actions
- SQLite for local development and managed PostgreSQL for production

## Architecture

```text
Shopify Admin ── embedded app + Admin purchase-option extension
      │
      ├── GraphQL Admin API 2026-07 ── selling plans, contracts, billing cycles
      ├── signed webhooks ───────────── local operational database
      └── due-cycle scheduler ───────── local approval queue (no charge)

Online store ── theme app block ── Shopify cart and Checkout

Customer account ── Customer Account API 2026-04
      ├── pause / resume / skip / cancel
      └── Shopify Intents API payment-method replacement

Your staff ── SubsManager Control Center (/control)
      ├── multi-store subscriptions, billing, and health
      ├── customer-approved charge ───── subscriptionBillingCycleCharge
      ├── protected live Shopify actions
      └── staff roles, MFA, sessions, and audit records
```

## Your external control center

The control center is independent of Shopify Admin, just like Recharge's operator dashboard. Open `https://YOUR_APP_DOMAIN/control/login` to manage all shops that installed the app. The embedded Shopify UI remains available to each merchant at `/app`.

On the first production sign-in, the backend creates the owner from `CONTROL_ADMIN_EMAIL` and `CONTROL_ADMIN_PASSWORD`. Owners and admins must then configure an authenticator app before protected operations are available. After the owner exists, remove or rotate the bootstrap password in the hosting dashboard.

## Shopify setup

Subscription APIs are available to apps created through the Shopify Partner or Dev Dashboard, not custom apps created inside a store Admin.

1. Create a public or custom-distribution app in the Shopify Dev Dashboard.
2. Request Shopify approval for the protected subscription and customer scopes used in `shopify.app.toml`.
3. Copy `.env.example` to `.env` and set `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, and `JOB_SECRET`.
4. Put the app's client ID in `shopify.app.toml`, then replace `https://subsmanager.example.com` with the production HTTPS origin.
5. Link the local project to that Dev Dashboard app:

   ```powershell
   pnpm shopify app config link --client-id YOUR_CLIENT_ID
   ```

6. Install dependencies and initialize the database:

   ```powershell
   pnpm install
   pnpm run setup
   ```

7. Start a development session and install it on a Shopify development store:

   ```powershell
   pnpm run dev
   ```

8. In the theme editor, add the **Subscription selector** app block to the product template. In Settings > Customer accounts, publish the **Manage subscriptions** extension and add the order-status block.

The requested scopes are intentionally explicit. Remove any feature and corresponding scope that will not ship before submitting the app for review.

## Due-cycle worker

Call the following endpoint from a private scheduler with an authorization header. A 15-minute interval is a reasonable production starting point.

```http
POST /api/jobs/renewals
Authorization: Bearer YOUR_JOB_SECRET
```

The endpoint queries active contracts that are due and synchronizes them into the protected control center. It does **not** create a Shopify billing attempt. Staff contact the customer first, then an owner or administrator opens the subscription and selects **Charge due cycle**.

Manual charges use a database idempotency key for each contract and billing date, so the same due cycle cannot be requested twice accidentally. Shopify webhooks supply the final attempt result.

## Recommended production hosting

Use a private GitHub repository for the source code and Render for the running backend. GitHub stores the code; it does not host the application server. The included `render.yaml` creates:

- one always-on Node web service for Shopify OAuth, webhooks, the embedded app, and your control center;
- one private-network PostgreSQL database;
- one cron job that detects due renewals every ten minutes without charging them.

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the exact deployment and Shopify URL setup. Vercel can run parts of this app, but Render is the simpler default here because the web process, managed database, migrations, and recurring worker are defined together.

## Verification

```powershell
# Generate React Router types and run TypeScript
pnpm run typecheck

# Build the production server and browser assets
pnpm run build

# Validate the Shopify project after adding a real client ID
pnpm shopify app config validate --json
```

The implementation has also been checked against:

- Admin GraphQL schema `2026-07`
- Customer Account GraphQL schema `2026-04`
- Admin purchase-option extension components `2026-04`
- Customer Account extension components `2026-04`
- Polaris app-home component types
- Theme Check in app-extension context

## App Store readiness

- Installation and OAuth are handled by Shopify's embedded app package; the public page does not ask merchants to enter a store domain.
- All merchant operations use GraphQL Admin API; there is no legacy REST Admin API usage.
- Customer charges remain in Shopify Checkout and payment details remain vaulted by Shopify.
- GDPR/customer-data webhooks and uninstall cleanup are configured in `shopify.app.toml`.
- The theme block shows price, discount, delivery/charge cadence, and automatic-renewal language.
- Customer self-service includes cancellation and Shopify's native payment-method replacement flow.
- The app is currently implemented as free to merchants. If it will be paid, configure Shopify Managed Pricing or the Shopify Billing API before release; off-platform app billing is not permitted.
- Before submission, provide real support, privacy-policy, terms-of-service, and emergency developer-contact URLs in the Dev Dashboard listing.
- Test install, reinstall, uninstall, consent screens, theme block placement, customer account authentication, failed payments, duplicate webhooks, and all protected-data redaction flows on a development store.

## Production commands

```powershell
pnpm run build
pnpm run setup
pnpm run start
```

Deploy the web process behind valid HTTPS, store all secrets in the hosting platform, persist the database, and run the renewal worker separately. Use `pnpm run deploy` to release the Shopify configuration and extensions after the project is linked.
