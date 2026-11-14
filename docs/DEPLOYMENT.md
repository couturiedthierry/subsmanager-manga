# Deploy SubsManager Manga

## Recommended setup

Use three connected pieces:

1. **GitHub private repository** — stores the source code and deployment history.
2. **Render web service** — runs Shopify authentication, webhooks, the merchant app, and your external control center.
3. **Render PostgreSQL and cron job** — store durable multi-store data and detect due renewals without charging them.

The repository includes `render.yaml`, so Render can create all hosting resources from one Blueprint.

## 1. Put the project in GitHub

Create a private GitHub repository, commit the complete project including `pnpm-lock.yaml`, and push the main branch. Never commit `.env` or any real secret.

## 2. Create the Render services

1. Sign in to Render and choose **New > Blueprint**.
2. Connect the private GitHub repository.
3. Select the repository and let Render read `render.yaml`.
4. Supply the requested secrets:

   | Variable | Value |
   | --- | --- |
   | `SHOPIFY_API_KEY` | Client ID from the Shopify Dev Dashboard |
   | `SHOPIFY_API_SECRET` | Client secret from the Shopify Dev Dashboard |
   | `SHOPIFY_APP_URL` | The final HTTPS Render URL or custom domain |
   | `CONTROL_ADMIN_EMAIL` | Email for your first control-center owner |
   | `CONTROL_ADMIN_PASSWORD` | A unique password with at least 12 characters |
   | `RESEND_API_KEY` | Resend API key for transactional subscription emails |
   | `SUBSCRIPTION_EMAIL_FROM` | Sender using a domain verified in Resend |

5. For the cron service's `SHOPIFY_APP_URL`, enter exactly the same public HTTPS origin as the web service.
6. Apply the Blueprint. Render creates the Node service, PostgreSQL database, migrations, health check, and renewal schedule.

The default Blueprint uses Virginia (US East), an always-on 512 MB web service, a small production PostgreSQL instance, and a cron job. Increase the web and database plans as the number of stores grows.

## 3. Configure the Shopify app URLs

In Shopify Dev Dashboard, set the app's URLs to the same public origin:

```text
App URL: https://YOUR_APP_DOMAIN

Allowed redirection URLs:
https://YOUR_APP_DOMAIN/auth/callback
https://YOUR_APP_DOMAIN/auth/shopify/callback
https://YOUR_APP_DOMAIN/api/auth/callback
```

Update the same placeholders in `shopify.app.toml`, link the project to the Dev Dashboard app, and deploy the Shopify configuration and extensions:

```powershell
pnpm shopify app config link --client-id YOUR_CLIENT_ID
pnpm run deploy
```

## 4. Create and protect the owner account

1. Open `https://YOUR_APP_DOMAIN/control/login`.
2. Sign in with `CONTROL_ADMIN_EMAIL` and `CONTROL_ADMIN_PASSWORD`.
3. The first successful login creates the owner in PostgreSQL.
4. Open **Security** and finish authenticator setup. MFA is mandatory for owners and admins.
5. Add other staff from **Team**, assigning the lowest role they need.
6. Remove or rotate `CONTROL_ADMIN_PASSWORD` in Render after the owner has been created. It is only a bootstrap credential; the stored account continues to work.

## 5. Install and test

Install the app on a Shopify development store and verify:

- the embedded app opens inside Shopify Admin;
- the store appears under **Control Center > Stores**;
- **Sync live data** loads plans and contracts;
- the customer account subscription page works;
- a test subscription webhook reaches the hosted URL;
- a new subscription sends the buyer a portal email exactly once;
- the Render health check reports `/api/health` as healthy;
- the due-cycle cron completes without an authorization error and reports `mode: manual-approval`.

## Production security notes

- Shopify access tokens stay server-side in PostgreSQL and are never returned to the control-center browser.
- Payment credentials stay vaulted by Shopify; only masked instrument details are displayed.
- If transactional email is enabled, list Resend as a subprocesser in the app privacy policy and complete any data-processing agreement your business requires.
- Render generates separate random values for session encryption, MFA-secret encryption, and renewal-job authentication.
- PostgreSQL public inbound access is disabled in the Blueprint.
- Use a custom domain, enable Render database backups, review the activity log, and revoke inactive staff promptly.
