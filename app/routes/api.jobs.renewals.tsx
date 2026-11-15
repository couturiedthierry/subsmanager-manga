import { timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { syncAllContracts } from "../models/control.server";
import { retryFailedEmails, sendDueRenewalReminders } from "../lib/subscription-email.server";
import { holdAllStores } from "../models/seal-renewals.server";

function authorized(request: Request) {
  const expected = process.env.JOB_SECRET || "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!expected || expected.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

export const loader = () => new Response("Method not allowed", { status: 405 });

/**
 * Scheduled synchronization. It refreshes every active contract so the control center
 * shows which renewals are due. It never creates a charge: charging is manual by design.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });

  const sessions = await prisma.session.findMany({
    where: { isOnline: false },
    select: { shop: true },
    distinct: ["shop"],
  });
  const startedAt = new Date();
  const summary: Array<{ shop: string; synchronized: number; due: number; remindersSent: number; error?: string }> = [];

  for (const { shop } of sessions) {
    try {
      const { admin } = await unauthenticated.admin(shop);
      const result = await syncAllContracts(shop, admin, "status:ACTIVE OR status:PAUSED OR status:FAILED");
      const remindersSent = await sendDueRenewalReminders(shop).catch(() => 0);
      summary.push({ shop, synchronized: result.synchronized, due: result.due, remindersSent });
    } catch (error) {
      summary.push({
        shop,
        synchronized: 0,
        due: 0,
        remindersSent: 0,
        error: error instanceof Error ? error.message : "Store processing failed",
      });
    }
  }

  // Stores billing through Seal with manual renewals: hold new renewals before Seal can charge them.
  const sealHolds = await holdAllStores().catch((error) => [
    { shop: "*", held: 0, errors: 0, subscriptions: 0, error: error instanceof Error ? error.message : "Seal hold failed" },
  ]);

  // Retry customer emails that failed because the email provider was briefly unavailable.
  const emailsRetried = await retryFailedEmails().catch(() => 0);

  return Response.json({
    ok: summary.every((entry) => !entry.error) && sealHolds.every((entry) => !entry.error),
    mode: "manual-approval",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    emailsRetried,
    shops: summary,
    sealHolds,
  });
};
