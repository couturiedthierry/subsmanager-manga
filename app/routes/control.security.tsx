import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import { Notice, PageHeader, Panel, StatusBadge, styles, useControlContext } from "../components/control-ui";
import prisma from "../db.server";
import { assertControlCsrf, assertControlOrigin, requireControlUser, writeAudit } from "../lib/control-auth.server";
import QRCode from "qrcode";
import { createTotpSetup, decryptSecret, encryptSecret, verifyTotp } from "../lib/control-crypto.server";

function securityRedirect(type: "notice" | "error", message: string) {
  return redirect(`/control/security?${type}=${encodeURIComponent(message)}`);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await requireControlUser(request, undefined, { requireMfa: false });
  const user = await prisma.staffUser.findUnique({
    where: { id: auth.user.id },
    include: { sessions: { orderBy: { lastSeenAt: "desc" } } },
  });
  if (!user) throw redirect("/control/login");
  const pendingSecret = user.mfaSecret && !user.mfaEnabled ? decryptSecret(user.mfaSecret) : null;
  const setupUri = pendingSecret ? createTotpSetup(user.email, pendingSecret).uri : null;
  const setup = pendingSecret && setupUri
    ? {
        secret: pendingSecret.replace(/(.{4})/g, "$1 ").trim(),
        uri: setupUri,
        qr: await QRCode.toDataURL(setupUri, { margin: 1, width: 220 }),
      }
    : null;
  const url = new URL(request.url);
  return {
    mfaEnabled: user.mfaEnabled,
    setup,
    sessions: user.sessions.map((session) => ({ ...session, current: session.id === auth.sessionId })),
    notice: url.searchParams.get("notice"),
    error: url.searchParams.get("error"),
    required: url.searchParams.get("required") === "1",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  assertControlOrigin(request);
  const auth = await requireControlUser(request, undefined, { requireMfa: false });
  const formData = await request.formData();
  assertControlCsrf(formData, auth);
  const intent = String(formData.get("intent") || "");
  const user = await prisma.staffUser.findUnique({ where: { id: auth.user.id } });
  if (!user) throw redirect("/control/login");
  if (user.mfaEnabled && !auth.mfaVerified) throw redirect("/control/mfa");

  try {
    if (intent === "start-mfa") {
      if (user.mfaEnabled) return securityRedirect("notice", "Two-factor authentication is already enabled");
      const setup = createTotpSetup(user.email);
      await prisma.staffUser.update({ where: { id: user.id }, data: { mfaSecret: encryptSecret(setup.secret), mfaEnabled: false } });
      await writeAudit({ actor: auth.user, request, action: "AUTH_MFA_SETUP_STARTED", resourceType: "STAFF_USER", resourceId: user.id, summary: "Started two-factor authentication setup" });
      return securityRedirect("notice", "Authenticator key created. Verify one code to finish setup");
    }
    if (intent === "enable-mfa") {
      const token = String(formData.get("token") || "");
      if (!user.mfaSecret || !verifyTotp(decryptSecret(user.mfaSecret), token)) throw new Error("That authentication code is invalid or expired");
      await prisma.$transaction([
        prisma.staffUser.update({ where: { id: user.id }, data: { mfaEnabled: true } }),
        prisma.staffSession.update({ where: { id: auth.sessionId }, data: { mfaVerified: true } }),
      ]);
      await writeAudit({ actor: auth.user, request, action: "AUTH_MFA_ENABLED", resourceType: "STAFF_USER", resourceId: user.id, summary: "Enabled two-factor authentication" });
      return securityRedirect("notice", "Two-factor authentication is now enabled");
    }
    if (intent === "disable-mfa") {
      const token = String(formData.get("token") || "");
      if (!user.mfaSecret || !verifyTotp(decryptSecret(user.mfaSecret), token)) throw new Error("Enter a valid authenticator code before disabling MFA");
      await prisma.staffUser.update({ where: { id: user.id }, data: { mfaSecret: null, mfaEnabled: false } });
      await writeAudit({ actor: auth.user, request, action: "AUTH_MFA_DISABLED", resourceType: "STAFF_USER", resourceId: user.id, summary: "Disabled two-factor authentication" });
      return securityRedirect("notice", "Two-factor authentication was disabled");
    }
    if (intent === "end-other-sessions") {
      const result = await prisma.staffSession.deleteMany({ where: { userId: user.id, id: { not: auth.sessionId } } });
      await writeAudit({ actor: auth.user, request, action: "AUTH_SESSIONS_REVOKED", resourceType: "STAFF_SESSION", summary: `Ended ${result.count} other active session${result.count === 1 ? "" : "s"}` });
      return securityRedirect("notice", `${result.count} other session${result.count === 1 ? "" : "s"} ended`);
    }
    throw new Error("Unknown security action");
  } catch (error) {
    return securityRedirect("error", error instanceof Error ? error.message : "Security update failed");
  }
};

export default function ControlSecurity() {
  const data = useLoaderData<typeof loader>();
  const { csrfToken } = useControlContext();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <>
      <PageHeader eyebrow="Account protection" title="Security" description="Protect your control-center account with an authenticator app and review every active session." />
      {data.notice ? <Notice tone="success">{data.notice}</Notice> : null}
      {data.error ? <Notice tone="critical">{data.error}</Notice> : null}
      {data.required && !data.mfaEnabled ? <Notice tone="info">Owners and administrators must enable two-factor authentication before using protected operations.</Notice> : null}
      <div className={styles.gridEqual}>
        <Panel title="Two-factor authentication" description="Compatible with Google Authenticator, 1Password, Authy, and similar TOTP apps.">
          <div className={styles.panelBody}>
            <p><StatusBadge value={data.mfaEnabled ? "Enabled" : "Not enabled"} /></p>
            {!data.mfaEnabled && !data.setup ? (
              <Form method="post" action="/api/control/security" reloadDocument><input type="hidden" name="_csrf" value={csrfToken} /><button className={styles.button} name="intent" value="start-mfa" type="submit" disabled={busy}>Set up authenticator</button></Form>
            ) : null}
            {!data.mfaEnabled && data.setup ? (
              <>
                <p className={styles.pageDescription}>Scan this code with your authenticator app (Google Authenticator, 1Password, Authy…):</p>
                <img src={data.setup.qr} alt="Authenticator setup QR code" width={220} height={220} style={{ borderRadius: 8, background: "#fff" }} />
                <p className={styles.pageDescription}>Can’t scan it? Choose “enter setup key” in the app and type:</p>
                <code className={styles.codeValue}>{data.setup.secret}</code>
                <details className={styles.advancedDetails}><summary>Show authenticator URI</summary><code className={styles.codeValue}>{data.setup.uri}</code></details>
                <Form method="post" action="/api/control/security" reloadDocument className={styles.formActions}>
                  <input type="hidden" name="_csrf" value={csrfToken} /><input type="hidden" name="intent" value="enable-mfa" />
                  <div className={styles.field}><label htmlFor="enable-token">Six-digit code</label><input id="enable-token" name="token" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" /></div>
                  <button className={styles.button} type="submit" disabled={busy}>Verify and enable</button>
                </Form>
              </>
            ) : null}
            {data.mfaEnabled ? (
              <Form method="post" action="/api/control/security" reloadDocument className={styles.formActions}>
                <input type="hidden" name="_csrf" value={csrfToken} /><input type="hidden" name="intent" value="disable-mfa" />
                <div className={styles.field}><label htmlFor="disable-token">Current six-digit code</label><input id="disable-token" name="token" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" /></div>
                <button className={styles.buttonDanger} type="submit" disabled={busy}>Disable MFA</button>
              </Form>
            ) : null}
          </div>
        </Panel>
        <Panel title="Security posture">
          <dl className={styles.summaryList}><div><dt>Session lifetime</dt><dd>12 hours</dd></div><div><dt>Cookies</dt><dd>Encrypted · HTTP-only · Secure</dd></div><div><dt>Cross-site requests</dt><dd>Origin and CSRF protected</dd></div><div><dt>Passwords</dt><dd>scrypt hashed</dd></div><div><dt>Secrets</dt><dd>AES-256-GCM encrypted</dd></div></dl>
        </Panel>
      </div>

      <Panel title="Active sessions" description="End every session except the browser you are using now." action={<Form method="post" action="/api/control/security" reloadDocument><input type="hidden" name="_csrf" value={csrfToken} /><button className={styles.buttonSecondary} name="intent" value="end-other-sessions" type="submit" disabled={busy || data.sessions.length <= 1}>End other sessions</button></Form>}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Session</th><th>Created</th><th>Last active</th><th>Expires</th><th>MFA</th></tr></thead>
            <tbody>{data.sessions.map((session) => <tr key={session.id}><td className={styles.primaryCell}>{session.current ? "This browser" : "Other browser"}<span className={styles.secondaryText}>{session.userAgent || "Unknown device"}</span></td><td>{new Date(session.createdAt).toLocaleString()}</td><td>{new Date(session.lastSeenAt).toLocaleString()}</td><td>{new Date(session.expiresAt).toLocaleString()}</td><td><StatusBadge value={session.mfaVerified ? "Verified" : "Not verified"} /></td></tr>)}</tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
