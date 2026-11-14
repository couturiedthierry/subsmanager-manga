# Updating SubsManager Manga without reinstalling it

SubsManager Manga keeps the same Shopify app identity and the same installed store session across normal releases.
Do not uninstall the app for routine updates.

## Web application changes

Changes under `app/`, database migrations, server jobs, and other hosted code are deployed by pushing
the verified commit to the GitHub `main` branch connected to Render. Render builds and replaces the web
service while preserving the PostgreSQL database and Shopify sessions.

After deployment, verify:

- `GET /api/health` returns `ok: true` and `database: connected`.
- The returned `version` matches the first seven characters of the Render Git commit.
- Opening SubsManager Manga from Shopify Admin loads the expected pages.

No Shopify reinstall is required for hosted-code changes.

## Shopify configuration and extension changes

Changes to access scopes, redirect URLs, webhooks, theme app extensions, admin extensions, or customer
account extensions must be released as a new Shopify app version. Releasing a version upgrades the
existing installation; it does not create a new app or require uninstalling SubsManager Manga.

Before releasing, ensure `shopify.app.toml` is linked to the production SubsManager Manga app and contains its
Client ID. Then validate and deploy:

```text
shopify app config validate --json
shopify app deploy --allow-updates
```

Do not use `--allow-deletes` in the normal release workflow because deleting an extension can also
delete related store data.

## Access-scope changes

- Existing required scopes remain active across web-code updates.
- New required scopes are delivered through Shopify managed installation. The merchant approves the
  Shopify permission prompt; uninstalling is not required.
- Future non-core permissions should be declared as optional scopes and requested only when the
  merchant enables the related feature.
- The `app/scopes_update` webhook updates every stored session for the shop after Shopify changes the
  granted scopes.

## Changes that do require a new installation

Only changing to a different Shopify app identity (a different Client ID), deleting the app, or losing
the installation itself requires a new install. Keep SubsManager Manga's Client ID and Secret stable. Rotating only
the Secret is supported when Render is updated immediately with the replacement value.
