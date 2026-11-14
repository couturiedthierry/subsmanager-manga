import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { StaffRole, StaffUser } from "@prisma/client";
import { createCookie, redirect } from "react-router";
import prisma from "../db.server";
import { hashPassword, verifyPassword } from "./control-crypto.server";

const SESSION_HOURS = 12;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const fallbackSecret = "subsmanager-local-control-session-secret";
const cookieSecret = process.env.CONTROL_SESSION_SECRET || fallbackSecret;

const controlCookie = createCookie(
  process.env.NODE_ENV === "production" ? "__Host-subsmanager_control" : "subsmanager_control",
  {
  httpOnly: true,
  maxAge: SESSION_HOURS * 60 * 60,
  path: "/",
  sameSite: "lax",
  secrets: [cookieSecret],
  secure: process.env.NODE_ENV === "production",
  },
);

export type SafeStaffUser = Pick<StaffUser, "id" | "email" | "name" | "role" | "mfaEnabled">;

export type ControlAuth = {
  user: SafeStaffUser;
  sessionId: string;
  csrfToken: string;
  mfaVerified: boolean;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function tokenHash(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

function csrfForToken(value: string) {
  return createHmac("sha256", cookieSecret).update(`csrf:${value}`).digest("base64url");
}

function requestMetadata(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  const ipHash = createHmac("sha256", cookieSecret).update(ip).digest("base64url");
  return {
    ipHash,
    userAgent: request.headers.get("user-agent")?.slice(0, 500) || null,
  };
}

export function missingControlConfiguration() {
  if (process.env.NODE_ENV !== "production") return [];
  const missing: string[] = [];
  if (!process.env.CONTROL_SESSION_SECRET || process.env.CONTROL_SESSION_SECRET.length < 32) {
    missing.push("CONTROL_SESSION_SECRET");
  }
  if (!process.env.CONTROL_ENCRYPTION_KEY || process.env.CONTROL_ENCRYPTION_KEY.length < 32) {
    missing.push("CONTROL_ENCRYPTION_KEY");
  }
  return missing;
}

export function assertControlOrigin(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site") throw new Response("Invalid request origin", { status: 403 });
  const origin = request.headers.get("origin");
  if (!origin) return;
  if (origin === "null") {
    if (site === "same-origin") return;
    throw new Response("Invalid request origin", { status: 403 });
  }

  let requestOrigin: string;
  let configuredOrigin: string;
  try {
    requestOrigin = new URL(origin).origin;
    configuredOrigin = process.env.SHOPIFY_APP_URL
      ? new URL(process.env.SHOPIFY_APP_URL).origin
      : new URL(request.url).origin;
  } catch {
    throw new Response("Invalid request origin", { status: 403 });
  }

  if (requestOrigin !== configuredOrigin) {
    throw new Response("Invalid request origin", { status: 403 });
  }
}

async function cookieToken(request: Request) {
  const parsed = await controlCookie.parse(request.headers.get("cookie"));
  return typeof parsed === "string" && parsed.length >= 32 ? parsed : null;
}

export async function getControlAuth(request: Request): Promise<ControlAuth | null> {
  const rawToken = await cookieToken(request);
  if (!rawToken) return null;
  const sessionId = tokenHash(rawToken);
  const session = await prisma.staffSession.findUnique({
    where: { id: sessionId },
    include: { user: true },
  });
  if (!session || session.expiresAt <= new Date() || !session.user.active) {
    if (session) await prisma.staffSession.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await prisma.staffSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
      mfaEnabled: session.user.mfaEnabled,
    },
    sessionId,
    csrfToken: csrfForToken(rawToken),
    mfaVerified: session.mfaVerified,
  };
}

export async function requireControlUser(
  request: Request,
  roles?: StaffRole[],
  options: { requireMfa?: boolean } = {},
) {
  const missing = missingControlConfiguration();
  if (missing.length) {
    throw new Response(`Control center is missing secure configuration: ${missing.join(", ")}`, {
      status: 503,
    });
  }
  const auth = await getControlAuth(request);
  if (!auth) throw redirect("/control/login");
  if (options.requireMfa ?? true) {
    if (auth.user.mfaEnabled && !auth.mfaVerified) throw redirect("/control/mfa");
    if (["OWNER", "ADMIN"].includes(auth.user.role) && !auth.user.mfaEnabled) {
      throw redirect("/control/security?required=1");
    }
  }
  if (roles && !roles.includes(auth.user.role)) {
    throw new Response("You do not have permission to perform this action", { status: 403 });
  }
  return auth;
}

export function assertControlCsrf(formData: FormData, auth: ControlAuth) {
  const supplied = String(formData.get("_csrf") || "");
  const expected = Buffer.from(auth.csrfToken);
  const actual = Buffer.from(supplied);
  if (!supplied || expected.length !== actual.length || !timingSafeEqual(actual, expected)) {
    throw new Response("Security token expired. Refresh the page and try again.", { status: 403 });
  }
}

async function ensureBootstrapOwner() {
  if (await prisma.staffUser.count()) return;
  const email = normalizeEmail(process.env.CONTROL_ADMIN_EMAIL || "");
  const password = process.env.CONTROL_ADMIN_PASSWORD || "";
  if (!email || password.length < 12) return;
  await prisma.staffUser.create({
    data: {
      email,
      name: process.env.CONTROL_ADMIN_NAME?.trim() || "SubsManager Owner",
      passwordHash: await hashPassword(password),
      role: "OWNER",
    },
  }).catch(() => undefined);
}

export async function authenticateStaff(emailInput: string, password: string, request: Request) {
  await ensureBootstrapOwner();
  const email = normalizeEmail(emailInput);
  const user = await prisma.staffUser.findUnique({ where: { email } });
  if (!user || !user.active || (user.lockedUntil && user.lockedUntil > new Date())) return null;
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const failed = user.failedLoginCount + 1;
    await prisma.staffUser.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failed >= MAX_FAILED_LOGINS ? 0 : failed,
        lockedUntil:
          failed >= MAX_FAILED_LOGINS
            ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
            : null,
      },
    });
    await writeAudit({
      actor: user,
      request,
      action: "AUTH_LOGIN_FAILED",
      resourceType: "STAFF_SESSION",
      summary: "A control-center login attempt failed",
    });
    return null;
  }
  await prisma.staffUser.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  return user;
}

export async function createControlSession(user: StaffUser, request: Request) {
  const rawToken = randomBytes(32).toString("base64url");
  const metadata = requestMetadata(request);
  await prisma.staffSession.create({
    data: {
      id: tokenHash(rawToken),
      userId: user.id,
      expiresAt: new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000),
      mfaVerified: !user.mfaEnabled,
      ...metadata,
    },
  });
  await writeAudit({
    actor: user,
    request,
    action: "AUTH_LOGIN_SUCCESS",
    resourceType: "STAFF_SESSION",
    summary: "Signed in to the SubsManager control center",
  });
  return redirect(user.mfaEnabled ? "/control/mfa" : "/control", {
    headers: { "Set-Cookie": await controlCookie.serialize(rawToken) },
  });
}

export async function markMfaVerified(auth: ControlAuth, request: Request) {
  await prisma.staffSession.update({ where: { id: auth.sessionId }, data: { mfaVerified: true } });
  await writeAudit({
    actor: auth.user,
    request,
    action: "AUTH_MFA_SUCCESS",
    resourceType: "STAFF_SESSION",
    summary: "Completed two-factor authentication",
  });
}

export async function destroyControlSession(request: Request) {
  const auth = await getControlAuth(request);
  if (auth) {
    await writeAudit({
      actor: auth.user,
      request,
      action: "AUTH_LOGOUT",
      resourceType: "STAFF_SESSION",
      summary: "Signed out of the SubsManager control center",
    });
    await prisma.staffSession.delete({ where: { id: auth.sessionId } }).catch(() => undefined);
  }
  return redirect("/control/login", {
    headers: { "Set-Cookie": await controlCookie.serialize("", { maxAge: 0 }) },
  });
}

export async function writeAudit(input: {
  actor: Pick<StaffUser, "id" | "email" | "role"> | SafeStaffUser;
  request: Request;
  action: string;
  resourceType: string;
  resourceId?: string;
  summary: string;
  shop?: { id: string; domain: string };
  metadata?: Record<string, unknown>;
}) {
  const { ipHash } = requestMetadata(input.request);
  return prisma.auditEvent.create({
    data: {
      actorId: input.actor.id,
      actorEmail: input.actor.email,
      actorRole: input.actor.role,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      summary: input.summary,
      shopId: input.shop?.id,
      shopDomain: input.shop?.domain,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
      ipHash,
    },
  });
}

export const controlRoles = {
  operators: ["OWNER", "ADMIN", "SUPPORT"] as StaffRole[],
  administrators: ["OWNER", "ADMIN"] as StaffRole[],
  owners: ["OWNER"] as StaffRole[],
};
