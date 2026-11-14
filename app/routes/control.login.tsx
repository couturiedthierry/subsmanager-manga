import type { LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import prisma from "../db.server";
import {
  getControlAuth,
  missingControlConfiguration,
} from "../lib/control-auth.server";
import { Notice, styles } from "../components/control-ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await getControlAuth(request);
  if (auth?.mfaVerified || (auth && !auth.user.mfaEnabled)) throw redirect("/control");
  if (auth) throw redirect("/control/mfa");
  const userCount = await prisma.staffUser.count();
  const bootstrapConfigured = Boolean(
    process.env.CONTROL_ADMIN_EMAIL && (process.env.CONTROL_ADMIN_PASSWORD?.length || 0) >= 12,
  );
  const error = new URL(request.url).searchParams.get("error") === "invalid"
    ? "The email or password is incorrect, or the account is temporarily locked."
    : null;
  return {
    userCount,
    bootstrapConfigured,
    missing: missingControlConfiguration(),
    error,
  };
};

export default function ControlLogin() {
  const { userCount, bootstrapConfigured, missing, error } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const unavailable = missing.length > 0 || (userCount === 0 && !bootstrapConfigured);

  return (
    <main className={styles.authRoot}>
      <div className={styles.authCard}>
        <div className={styles.authBrand}>
          <span className={styles.brandMark}>SM</span>
          SubsManager Control Center
        </div>
        <h1>Welcome back</h1>
        <p>Sign in to manage connected stores, subscription contracts, renewals, and support operations.</p>

        {missing.length ? (
          <Notice tone="critical">Production security is incomplete: {missing.join(", ")}.</Notice>
        ) : null}
        {userCount === 0 && !bootstrapConfigured ? (
          <Notice tone="info">
            Add CONTROL_ADMIN_EMAIL and a 12+ character CONTROL_ADMIN_PASSWORD to create the first owner.
          </Notice>
        ) : null}
        {error ? <Notice tone="critical">{error}</Notice> : null}

        <Form method="post" action="/api/control/login" reloadDocument>
          <div className={styles.field}>
            <label htmlFor="control-email">Email</label>
            <input id="control-email" name="email" type="email" autoComplete="username" required disabled={unavailable} />
          </div>
          <div className={styles.field}>
            <label htmlFor="control-password">Password</label>
            <input id="control-password" name="password" type="password" autoComplete="current-password" required disabled={unavailable} />
          </div>
          <button className={styles.button} type="submit" disabled={unavailable || navigation.state !== "idle"}>
            {navigation.state === "submitting" ? "Signing in…" : "Sign in securely"}
          </button>
        </Form>
        <div className={styles.authFoot}>Protected staff access · Sessions expire after 12 hours</div>
      </div>
    </main>
  );
}
