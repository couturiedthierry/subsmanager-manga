import type { StaffRole } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import { Notice, PageHeader, Panel, StatusBadge, styles, useControlContext } from "../components/control-ui";
import prisma from "../db.server";
import { assertControlCsrf, assertControlOrigin, controlRoles, requireControlUser, writeAudit } from "../lib/control-auth.server";
import { hashPassword } from "../lib/control-crypto.server";

const allRoles: StaffRole[] = ["OWNER", "ADMIN", "SUPPORT", "VIEWER"];

function messageRedirect(type: "notice" | "error", message: string) {
  return redirect(`/control/team?${type}=${encodeURIComponent(message)}`);
}

function allowedTargetRoles(actorRole: StaffRole) {
  return actorRole === "OWNER" ? allRoles : (["SUPPORT", "VIEWER"] as StaffRole[]);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireControlUser(request, controlRoles.administrators);
  const users = await prisma.staffUser.findMany({
    include: { _count: { select: { sessions: true } } },
    orderBy: [{ active: "desc" }, { role: "asc" }, { name: "asc" }],
  });
  const url = new URL(request.url);
  return { users, notice: url.searchParams.get("notice"), error: url.searchParams.get("error") };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  assertControlOrigin(request);
  const auth = await requireControlUser(request, controlRoles.administrators);
  const formData = await request.formData();
  assertControlCsrf(formData, auth);
  const intent = String(formData.get("intent") || "");
  const allowed = allowedTargetRoles(auth.user.role);

  try {
    if (intent === "create") {
      const email = String(formData.get("email") || "").trim().toLowerCase();
      const name = String(formData.get("name") || "").trim();
      const password = String(formData.get("password") || "");
      const role = String(formData.get("role") || "SUPPORT") as StaffRole;
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid staff email address");
      if (name.length < 2) throw new Error("Enter the staff member's name");
      if (!allowed.includes(role)) throw new Error("You cannot assign that role");
      const user = await prisma.staffUser.create({
        data: { email, name, passwordHash: await hashPassword(password), role },
      });
      await writeAudit({ actor: auth.user, request, action: "STAFF_CREATED", resourceType: "STAFF_USER", resourceId: user.id, summary: `Created staff account ${email}`, metadata: { role } });
      return messageRedirect("notice", "Staff account created");
    }

    const id = String(formData.get("userId") || "");
    const target = await prisma.staffUser.findUnique({ where: { id } });
    if (!target) throw new Error("Staff account was not found");
    if (auth.user.role !== "OWNER" && !allowed.includes(target.role)) {
      throw new Error("Only an owner can manage owner and admin accounts");
    }

    if (intent === "role") {
      const role = String(formData.get("role") || "") as StaffRole;
      if (target.id === auth.user.id) throw new Error("You cannot change your own role");
      if (!allowed.includes(role)) throw new Error("You cannot assign that role");
      if (target.role === "OWNER" && role !== "OWNER" && await prisma.staffUser.count({ where: { role: "OWNER", active: true } }) <= 1) {
        throw new Error("The last active owner cannot be demoted");
      }
      await prisma.staffUser.update({ where: { id }, data: { role } });
      await writeAudit({ actor: auth.user, request, action: "STAFF_ROLE_CHANGED", resourceType: "STAFF_USER", resourceId: id, summary: `Changed ${target.email} to ${role.toLowerCase()}`, metadata: { previousRole: target.role, role } });
      return messageRedirect("notice", "Staff role updated");
    }

    if (intent === "toggle") {
      if (target.id === auth.user.id) throw new Error("You cannot deactivate your own account");
      if (target.role === "OWNER" && target.active && await prisma.staffUser.count({ where: { role: "OWNER", active: true } }) <= 1) {
        throw new Error("The last active owner cannot be deactivated");
      }
      const active = !target.active;
      await prisma.$transaction([
        prisma.staffUser.update({ where: { id }, data: { active } }),
        ...(active ? [] : [prisma.staffSession.deleteMany({ where: { userId: id } })]),
      ]);
      await writeAudit({ actor: auth.user, request, action: active ? "STAFF_ACTIVATED" : "STAFF_DEACTIVATED", resourceType: "STAFF_USER", resourceId: id, summary: `${active ? "Activated" : "Deactivated"} ${target.email}` });
      return messageRedirect("notice", active ? "Staff account activated" : "Staff account deactivated");
    }

    if (intent === "password") {
      const password = String(formData.get("password") || "");
      await prisma.$transaction([
        prisma.staffUser.update({ where: { id }, data: { passwordHash: await hashPassword(password), failedLoginCount: 0, lockedUntil: null } }),
        prisma.staffSession.deleteMany({ where: { userId: id } }),
      ]);
      await writeAudit({ actor: auth.user, request, action: "STAFF_PASSWORD_RESET", resourceType: "STAFF_USER", resourceId: id, summary: `Reset password and signed out ${target.email}` });
      return messageRedirect("notice", "Password reset and existing sessions ended");
    }
    throw new Error("Unknown team action");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Team update failed";
    return messageRedirect("error", message.includes("Unique constraint") ? "That email is already in use" : message);
  }
};

export default function ControlTeam() {
  const { users, notice, error } = useLoaderData<typeof loader>();
  const { user, csrfToken } = useControlContext();
  const navigation = useNavigation();
  const assignableRoles = allowedTargetRoles(user.role);
  const busy = navigation.state !== "idle";

  return (
    <>
      <PageHeader eyebrow="Administration" title="Team access" description="Invite operators, apply least-privilege roles, and revoke access immediately." />
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice tone="critical">{error}</Notice> : null}
      <div className={styles.gridTwo}>
        <Panel title="Staff accounts" description="Changing a password or deactivating an account ends its active sessions.">
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Staff member</th><th>Role</th><th>Security</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {users.map((member) => {
                  const canManage = user.role === "OWNER" || assignableRoles.includes(member.role);
                  return (
                    <tr key={member.id}>
                      <td className={styles.primaryCell}>{member.name}<span className={styles.secondaryText}>{member.email}</span></td>
                      <td>
                        {canManage && member.id !== user.id ? (
                          <Form method="post" className={styles.inlineForm}>
                            <input type="hidden" name="_csrf" value={csrfToken} /><input type="hidden" name="intent" value="role" /><input type="hidden" name="userId" value={member.id} />
                            <select name="role" defaultValue={member.role} aria-label={`Role for ${member.name}`}>{assignableRoles.map((role) => <option key={role} value={role}>{role}</option>)}</select>
                            <button className={styles.buttonGhost} type="submit" disabled={busy}>Save</button>
                          </Form>
                        ) : <StatusBadge value={member.role} />}
                      </td>
                      <td>{member.mfaEnabled ? "MFA enabled" : "Password only"}<span className={styles.secondaryText}>{member._count.sessions} active session{member._count.sessions === 1 ? "" : "s"}</span></td>
                      <td><StatusBadge value={member.active ? "Active" : "Disabled"} /></td>
                      <td>
                        {canManage && member.id !== user.id ? (
                          <Form method="post"><input type="hidden" name="_csrf" value={csrfToken} /><input type="hidden" name="intent" value="toggle" /><input type="hidden" name="userId" value={member.id} /><button className={styles.buttonGhost} type="submit" disabled={busy}>{member.active ? "Deactivate" : "Activate"}</button></Form>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <aside>
          <Panel title="Add staff member" description="Use a unique password of at least 12 characters.">
            <Form method="post" className={styles.panelBody}>
              <input type="hidden" name="_csrf" value={csrfToken} /><input type="hidden" name="intent" value="create" />
              <div className={styles.field}><label htmlFor="staff-name">Name</label><input id="staff-name" name="name" required minLength={2} /></div>
              <div className={styles.field}><label htmlFor="staff-email">Email</label><input id="staff-email" name="email" type="email" required /></div>
              <div className={styles.field}><label htmlFor="staff-role">Role</label><select id="staff-role" name="role" defaultValue="SUPPORT">{assignableRoles.map((role) => <option key={role} value={role}>{role}</option>)}</select></div>
              <div className={styles.field}><label htmlFor="staff-password">Temporary password</label><input id="staff-password" name="password" type="password" minLength={12} required autoComplete="new-password" /></div>
              <button className={styles.button} type="submit" disabled={busy}>Create account</button>
            </Form>
          </Panel>
          <Panel title="Role guide">
            <dl className={styles.summaryList}>
              <div><dt>Owner</dt><dd>All access and team control</dd></div><div><dt>Admin</dt><dd>Billing and operational access</dd></div><div><dt>Support</dt><dd>Non-destructive customer help</dd></div><div><dt>Viewer</dt><dd>Read-only visibility</dd></div>
            </dl>
          </Panel>
        </aside>
      </div>

      <Panel title="Reset a staff password" description="The selected staff member will be signed out everywhere.">
        <Form method="post" className={styles.filters}>
          <input type="hidden" name="_csrf" value={csrfToken} /><input type="hidden" name="intent" value="password" />
          <div className={styles.field}><label htmlFor="reset-user">Staff member</label><select id="reset-user" name="userId">{users.filter((member) => user.role === "OWNER" || assignableRoles.includes(member.role)).map((member) => <option key={member.id} value={member.id}>{member.name} · {member.email}</option>)}</select></div>
          <div className={styles.field}><label htmlFor="reset-password">New password</label><input id="reset-password" name="password" type="password" minLength={12} required autoComplete="new-password" /></div>
          <button className={styles.buttonDanger} type="submit" disabled={busy}>Reset and sign out</button>
        </Form>
      </Panel>
    </>
  );
}
