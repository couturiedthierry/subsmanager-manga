import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, NavLink, Outlet, useLoaderData, useLocation } from "react-router";
import {
  assertControlCsrf,
  assertControlOrigin,
  destroyControlSession,
  getControlAuth,
  requireControlUser,
} from "../lib/control-auth.server";
import { styles } from "../components/control-ui";

export const meta: MetaFunction = () => [
  { title: "SubsManager Control Center" },
  { name: "robots", content: "noindex,nofollow,noarchive" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await getControlAuth(request);
  return {
    auth: auth
      ? {
          user: auth.user,
          csrfToken: auth.csrfToken,
          mfaVerified: auth.mfaVerified,
        }
      : null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  assertControlOrigin(request);
  const auth = await requireControlUser(request, undefined, { requireMfa: false });
  const formData = await request.formData();
  assertControlCsrf(formData, auth);
  if (formData.get("intent") === "logout") return destroyControlSession(request);
  return new Response("Unknown action", { status: 400 });
};

type NavigationItem = { label: string; to: string; icon: string; end?: boolean };

const navigation: NavigationItem[] = [
  { label: "Overview", to: "/control", icon: "OV", end: true },
  { label: "Stores", to: "/control/stores", icon: "ST" },
  { label: "Subscriptions", to: "/control/subscriptions", icon: "SU" },
  { label: "Billing", to: "/control/billing", icon: "BI" },
  { label: "Activity", to: "/control/activity", icon: "AC" },
];

const administration: NavigationItem[] = [
  { label: "Team", to: "/control/team", icon: "TM" },
  { label: "Security", to: "/control/security", icon: "SE" },
];

function NavigationLinks({ mobile = false, role }: { mobile?: boolean; role?: string }) {
  const adminLinks = administration.filter((item) => item.to !== "/control/team" || role === "OWNER" || role === "ADMIN");
  const links = mobile ? [...navigation, ...adminLinks] : navigation;
  return (
    <>
      {links.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end}>
          {!mobile ? <span className={styles.navIcon}>{item.icon}</span> : null}
          {item.label}
        </NavLink>
      ))}
    </>
  );
}

export default function ControlLayout() {
  const { auth } = useLoaderData<typeof loader>();
  const location = useLocation();
  const isAuthenticationRoute = location.pathname === "/control/login" || location.pathname === "/control/mfa";

  if (!auth || isAuthenticationRoute || (auth.user.mfaEnabled && !auth.mfaVerified)) {
    return <Outlet />;
  }

  return (
    <div className={styles.controlRoot}>
      <aside className={styles.sidebar}>
        <NavLink className={styles.brand} to="/control" end>
          <span className={styles.brandMark}>SM</span>
          <span className={styles.brandCopy}>
            <span>SubsManager</span>
            <small>Control center</small>
          </span>
        </NavLink>

        <nav className={styles.nav} aria-label="Control center navigation">
          <p className={styles.navLabel}>Operations</p>
          <NavigationLinks role={auth.user.role} />
          <p className={styles.navLabel}>Administration</p>
          {administration.filter((item) => item.to !== "/control/team" || auth.user.role === "OWNER" || auth.user.role === "ADMIN").map((item) => (
            <NavLink key={item.to} to={item.to}>
              <span className={styles.navIcon}>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className={styles.sidebarUser}>
          <strong>{auth.user.name}</strong>
          <span>{auth.user.role.toLowerCase()} · {auth.user.email}</span>
          <Form method="post" action="/control">
            <input type="hidden" name="_csrf" value={auth.csrfToken} />
            <button className={styles.logoutButton} type="submit" name="intent" value="logout">
              Sign out
            </button>
          </Form>
        </div>
      </aside>

      <div className={styles.mainColumn}>
        <header className={styles.topbar}>
          <span className={styles.topbarTitle}>Multi-store subscription operations</span>
          <span className={styles.topbarStatus}><i aria-hidden="true" /> Renewals: manual approval</span>
          <Form method="post" action="/control" className={styles.mobileSignOut}>
            <input type="hidden" name="_csrf" value={auth.csrfToken} />
            <button className={styles.logoutButton} type="submit" name="intent" value="logout">Sign out</button>
          </Form>
        </header>
        <nav className={styles.mobileNav} aria-label="Mobile navigation">
          <NavigationLinks mobile role={auth.user.role} />
        </nav>
        <main className={styles.content}>
          <Outlet context={{ user: auth.user, csrfToken: auth.csrfToken }} />
        </main>
      </div>
    </div>
  );
}

// The Content-Security-Policy (with a per-request script nonce) is set in entry.server.tsx.
// "same-origin" keeps URLs private from other sites while letting the browser send the
// Origin header that React Router's built-in CSRF protection requires.
export const headers: HeadersFunction = () => ({
  "Cache-Control": "no-store",
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});
