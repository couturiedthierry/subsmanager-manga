import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import prisma from "../db.server";
import {
  assertControlCsrf,
  assertControlOrigin,
  markMfaVerified,
  requireControlUser,
} from "../lib/control-auth.server";
import { decryptSecret, verifyTotp } from "../lib/control-crypto.server";
import { Notice, styles } from "../components/control-ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await requireControlUser(request, undefined, { requireMfa: false });
  if (!auth.user.mfaEnabled || auth.mfaVerified) throw redirect("/control");
  return { csrfToken: auth.csrfToken, email: auth.user.email };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  assertControlOrigin(request);
  const auth = await requireControlUser(request, undefined, { requireMfa: false });
  const formData = await request.formData();
  assertControlCsrf(formData, auth);
  const user = await prisma.staffUser.findUnique({ where: { id: auth.user.id } });
  const token = String(formData.get("token") || "");
  if (!user?.mfaSecret || !verifyTotp(decryptSecret(user.mfaSecret), token)) {
    return { error: "That authentication code is invalid or expired." };
  }
  await markMfaVerified(auth, request);
  return redirect("/control");
};

export default function ControlMfa() {
  const { csrfToken } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  return (
    <main className={styles.authRoot}>
      <div className={styles.authCard}>
        <div className={styles.authBrand}>
          <span className={styles.brandMark}>SM</span>
          SubsManager Control Center
        </div>
        <h1>Two-factor verification</h1>
        <p>Enter the six-digit code from your authenticator app to complete sign-in.</p>
        {actionData?.error ? <Notice tone="critical">{actionData.error}</Notice> : null}
        <Form method="post">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <div className={styles.field}>
            <label htmlFor="control-token">Authentication code</label>
            <input
              className={styles.input}
              id="control-token"
              name="token"
              inputMode="numeric"
              pattern="[0-9]{6}"
              autoComplete="one-time-code"
              maxLength={6}
              required
            />
          </div>
          <button className={styles.button} type="submit" disabled={navigation.state !== "idle"}>
            {navigation.state === "submitting" ? "Verifying…" : "Verify and continue"}
          </button>
        </Form>
      </div>
    </main>
  );
}
