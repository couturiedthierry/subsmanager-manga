import type { Shop } from "@prisma/client";
import prisma from "../db.server";
import { graphqlRequest } from "./graphql.server";
import { SUBSCRIPTION_DETAIL_QUERY } from "./shopify-queries";
import { unauthenticated } from "../shopify.server";
import { ensureShop } from "../models/shop.server";

const DAY = 24 * 60 * 60 * 1000;

export type EmailType =
  | "SUBSCRIPTION_WELCOME"
  | "RENEWAL_REMINDER"
  | "PAYMENT_FAILED"
  | "STATUS_CHANGE"
  | "TEST";

type ToggleField = "emailWelcome" | "emailRenewalReminder" | "emailPaymentFailed" | "emailStatusChange";

const TOGGLES: Record<Exclude<EmailType, "TEST">, ToggleField> = {
  SUBSCRIPTION_WELCOME: "emailWelcome",
  RENEWAL_REMINDER: "emailRenewalReminder",
  PAYMENT_FAILED: "emailPaymentFailed",
  STATUS_CHANGE: "emailStatusChange",
};

type SendResult = { sent: boolean; reason?: string };

type ContractEmailData = {
  shop: { name: string; contactEmail: string | null };
  subscriptionContract: {
    id: string;
    status: string;
    currencyCode: string;
    nextBillingDate: string | null;
    customer: {
      displayName: string;
      defaultEmailAddress: { emailAddress: string } | null;
    } | null;
    lines: {
      nodes: Array<{ title: string; quantity: number; lineDiscountedPrice: { amount: string; currencyCode: string } }>;
    };
  } | null;
};

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.SUBSCRIPTION_EMAIL_FROM);
}

/** True when the store allows this kind of email (master switch and the individual switch). */
export function emailAllowed(shop: Shop, type: EmailType) {
  if (type === "TEST") return true;
  return shop.emailsEnabled && shop[TOGGLES[type]];
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] || character);
}

function money(amount: number, currencyCode: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode }).format(amount);
}

function longDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(new Date(value));
}

/** Simple, email-client-safe layout shared by every message. */
function layout(input: {
  shopName: string;
  heading: string;
  paragraphs: string[];
  button?: { label: string; url: string };
}) {
  const shopName = escapeHtml(input.shopName);
  const body = input.paragraphs.map((text) => `<p style="margin:0 0 14px;line-height:1.5">${text}</p>`).join("");
  const button = input.button
    ? `<p style="margin:22px 0"><a href="${escapeHtml(input.button.url)}" style="display:inline-block;background:#0b4f31;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600">${escapeHtml(input.button.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f4f6f4;padding:24px 12px"><div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;background:#ffffff;border-radius:12px;padding:28px;color:#17231b"><p style="margin:0 0 18px;color:#667169;font-size:13px">${shopName}</p><h1 style="font-size:22px;margin:0 0 16px">${escapeHtml(input.heading)}</h1>${body}${button}<p style="margin:24px 0 0;color:#667169;font-size:12px">Card details stay securely with Shopify. Reply to this email if you need help.</p></div></body></html>`;
}

function toText(paragraphs: string[], button?: { label: string; url: string }) {
  const plain = paragraphs.map((text) => text.replace(/<[^>]+>/g, "")).join("\n\n");
  return button ? `${plain}\n\n${button.label}: ${button.url}` : plain;
}

async function callResend(input: {
  key: string;
  to: string;
  replyTo: string | null;
  subject: string;
  html: string;
  text: string;
}) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": input.key.slice(0, 256),
    },
    body: JSON.stringify({
      from: process.env.SUBSCRIPTION_EMAIL_FROM,
      to: [input.to],
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      subject: input.subject,
      text: input.text,
      html: input.html,
    }),
    signal: AbortSignal.timeout(8_000),
  });
  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!response.ok || !body.id) {
    throw new Error(`Email provider returned ${response.status}${body.message ? `: ${body.message}` : ""}`);
  }
  return body.id;
}

/**
 * Sends one customer email at most once per key. Checks the store's switches first, so a
 * disabled email is never queued and can still go out later if the store turns it back on.
 */
async function deliver(input: {
  shop: Shop;
  type: EmailType;
  key: string;
  contractId: string | null;
  build: () => Promise<{ to: string | null; replyTo: string | null; subject: string; html: string; text: string } | null>;
}): Promise<SendResult> {
  const { shop, type, key } = input;
  if (!emailAllowed(shop, type)) return { sent: false, reason: "disabled" };
  if (!emailConfigured()) return { sent: false, reason: "not-configured" };

  const existing = await prisma.customerNotification.findUnique({ where: { key } });
  if (existing?.status === "SENT") return { sent: false, reason: "already-sent" };
  const record = existing || await prisma.customerNotification.create({
    data: { shopId: shop.id, key, type, contractId: input.contractId },
  });

  const message = await input.build();
  if (!message?.to) {
    await prisma.customerNotification.update({
      where: { id: record.id },
      data: { status: "SKIPPED", lastError: "The customer has no email address" },
    });
    return { sent: false, reason: "no-recipient" };
  }

  try {
    const providerId = await callResend({ key, ...message, to: message.to });
    await prisma.customerNotification.update({
      where: { id: record.id },
      data: {
        status: "SENT",
        providerId,
        recipient: message.to,
        lastError: null,
        sentAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    return { sent: true };
  } catch (error) {
    await prisma.customerNotification.update({
      where: { id: record.id },
      data: {
        status: "FAILURE",
        recipient: message.to,
        lastError: (error instanceof Error ? error.message : "Email failed").slice(0, 500),
        attempts: { increment: 1 },
      },
    });
    throw error;
  }
}

async function loadContract(shopDomain: string, contractId: string) {
  const { admin } = await unauthenticated.admin(shopDomain);
  const data = await graphqlRequest<ContractEmailData>(admin, SUBSCRIPTION_DETAIL_QUERY, {
    id: contractId,
    startDate: new Date(Date.now() - DAY).toISOString(),
    endDate: new Date(Date.now() + 400 * DAY).toISOString(),
  });
  const contract = data.subscriptionContract;
  if (!contract) return null;
  const total = contract.lines.nodes.reduce(
    (sum, line) => sum + Number(line.lineDiscountedPrice.amount) * line.quantity,
    0,
  );
  return {
    shopName: data.shop.name,
    contactEmail: data.shop.contactEmail,
    to: contract.customer?.defaultEmailAddress?.emailAddress || null,
    customerName: contract.customer?.displayName || "there",
    product: contract.lines.nodes[0]?.title || "your subscription",
    extraItems: Math.max(0, contract.lines.nodes.length - 1),
    total: money(total, contract.currencyCode),
    nextBillingDate: contract.nextBillingDate,
    portalUrl: `https://${shopDomain}/account`,
  };
}

function productLabel(product: string, extraItems: number) {
  const safe = `<strong>${escapeHtml(product)}</strong>`;
  return extraItems ? `${safe} and ${extraItems} more item${extraItems === 1 ? "" : "s"}` : safe;
}

export async function sendSubscriptionWelcomeEmail(shopDomain: string, contractId: string) {
  const shop = await ensureShop(shopDomain);
  return deliver({
    shop,
    type: "SUBSCRIPTION_WELCOME",
    key: `subscription-welcome:${shopDomain}:${contractId}`,
    contractId,
    build: async () => {
      const c = await loadContract(shopDomain, contractId);
      if (!c) return null;
      const button = { label: "Manage subscription", url: c.portalUrl };
      const paragraphs = [
        `Hello ${escapeHtml(c.customerName)},`,
        `Thanks for subscribing! Your subscription for ${productLabel(c.product, c.extraItems)} from ${escapeHtml(c.shopName)} is active.`,
        "You can see upcoming orders, update your payment method, skip, pause, or cancel at any time from your account.",
      ];
      return {
        to: c.to,
        replyTo: shop.supportEmail || c.contactEmail,
        subject: `Your subscription with ${c.shopName} is active`,
        html: layout({ shopName: c.shopName, heading: "Your subscription is active", paragraphs, button }),
        text: toText(paragraphs, button),
      };
    },
  });
}

export async function sendRenewalReminderEmail(shopDomain: string, contractId: string, billingDate: Date) {
  const shop = await ensureShop(shopDomain);
  return deliver({
    shop,
    type: "RENEWAL_REMINDER",
    key: `renewal-reminder:${shopDomain}:${contractId}:${billingDate.toISOString().slice(0, 10)}`,
    contractId,
    build: async () => {
      const c = await loadContract(shopDomain, contractId);
      if (!c) return null;
      const button = { label: "Review my subscription", url: c.portalUrl };
      const paragraphs = [
        `Hello ${escapeHtml(c.customerName)},`,
        `Your next ${productLabel(c.product, c.extraItems)} order from ${escapeHtml(c.shopName)} is coming up on <strong>${longDate(billingDate)}</strong>. The order total is about <strong>${escapeHtml(c.total)}</strong> plus any shipping and taxes.`,
        "Need to make a change? You can skip this order, pause, update your payment method, or cancel from your account.",
      ];
      return {
        to: c.to,
        replyTo: shop.supportEmail || c.contactEmail,
        subject: `Your next order from ${c.shopName} is coming up`,
        html: layout({ shopName: c.shopName, heading: "Your next order is coming up", paragraphs, button }),
        text: toText(paragraphs, button),
      };
    },
  });
}

export async function sendPaymentFailedEmail(shopDomain: string, contractId: string, attemptId: string) {
  const shop = await ensureShop(shopDomain);
  return deliver({
    shop,
    type: "PAYMENT_FAILED",
    key: `payment-failed:${shopDomain}:${attemptId}`,
    contractId,
    build: async () => {
      const c = await loadContract(shopDomain, contractId);
      if (!c) return null;
      const button = { label: "Update payment method", url: c.portalUrl };
      const paragraphs = [
        `Hello ${escapeHtml(c.customerName)},`,
        `We couldn't process the payment for your ${productLabel(c.product, c.extraItems)} subscription from ${escapeHtml(c.shopName)}.`,
        "Please update your payment method so your next order can go through. It only takes a minute.",
      ];
      return {
        to: c.to,
        replyTo: shop.supportEmail || c.contactEmail,
        subject: `Action needed: update your payment for ${c.shopName}`,
        html: layout({ shopName: c.shopName, heading: "Your payment didn't go through", paragraphs, button }),
        text: toText(paragraphs, button),
      };
    },
  });
}

const STATUS_COPY: Record<string, { subject: string; heading: string; line: string }> = {
  PAUSED: {
    subject: "Your subscription is paused",
    heading: "Your subscription is paused",
    line: "No orders will be placed and you won't be charged until it is resumed.",
  },
  ACTIVE: {
    subject: "Your subscription is active again",
    heading: "Welcome back! Your subscription is active",
    line: "Your orders will continue on their regular schedule.",
  },
  CANCELLED: {
    subject: "Your subscription has been cancelled",
    heading: "Your subscription has been cancelled",
    line: "You won't be charged again and no further orders will be placed. We'd love to have you back any time.",
  },
};

export async function sendStatusChangeEmail(
  shopDomain: string,
  contractId: string,
  status: string,
  eventId: string,
) {
  const copy = STATUS_COPY[status];
  if (!copy) return { sent: false, reason: "unsupported-status" };
  const shop = await ensureShop(shopDomain);
  return deliver({
    shop,
    type: "STATUS_CHANGE",
    key: `status-${status.toLowerCase()}:${shopDomain}:${contractId}:${eventId}`,
    contractId,
    build: async () => {
      const c = await loadContract(shopDomain, contractId);
      if (!c) return null;
      const button = { label: "View my subscription", url: c.portalUrl };
      const paragraphs = [
        `Hello ${escapeHtml(c.customerName)},`,
        `This confirms a change to your ${productLabel(c.product, c.extraItems)} subscription from ${escapeHtml(c.shopName)}.`,
        copy.line,
      ];
      return {
        to: c.to,
        replyTo: shop.supportEmail || c.contactEmail,
        subject: `${copy.subject} — ${c.shopName}`,
        html: layout({ shopName: c.shopName, heading: copy.heading, paragraphs, button }),
        text: toText(paragraphs, button),
      };
    },
  });
}

/** Lets the merchant confirm that email delivery works. Not affected by the switches. */
export async function sendTestEmail(shopDomain: string, to: string) {
  const shop = await ensureShop(shopDomain);
  return deliver({
    shop,
    type: "TEST",
    key: `test:${shopDomain}:${Date.now()}`,
    contractId: null,
    build: async () => {
      const shopName = shop.displayName || shopDomain;
      const paragraphs = [
        "This is a test email from SubsManager Manga.",
        "If you can read this, subscription emails are set up correctly for your store.",
      ];
      return {
        to,
        replyTo: shop.supportEmail,
        subject: `Test email from SubsManager Manga for ${shopName}`,
        html: layout({ shopName, heading: "Emails are working", paragraphs }),
        text: toText(paragraphs),
      };
    },
  });
}

/**
 * Sends reminders for active subscriptions whose billing date falls within each store's
 * reminder window. Uses the contract mirror that the scheduled job refreshes just before.
 */
export async function sendDueRenewalReminders(shopDomain: string) {
  const shop = await ensureShop(shopDomain);
  if (!emailAllowed(shop, "RENEWAL_REMINDER") || !emailConfigured()) return 0;
  const now = new Date();
  const windowEnd = new Date(now.getTime() + Math.max(1, shop.reminderDaysBefore) * DAY);
  const contracts = await prisma.subscriptionContract.findMany({
    where: { shopId: shop.id, status: "ACTIVE", nextBillingAt: { gt: now, lte: windowEnd } },
    take: 500,
  });
  let sent = 0;
  for (const contract of contracts) {
    if (!contract.nextBillingAt) continue;
    const result = await sendRenewalReminderEmail(shopDomain, contract.shopifyId, contract.nextBillingAt)
      .catch(() => ({ sent: false }));
    if (result.sent) sent += 1;
  }
  return sent;
}

/** Retries emails that failed because the provider was briefly unavailable (max 3 tries). */
export async function retryFailedEmails() {
  const failed = await prisma.customerNotification.findMany({
    where: { status: "FAILURE", attempts: { lt: 3 }, contractId: { not: null }, type: { not: "TEST" } },
    include: { shop: true },
    take: 25,
  });
  let retried = 0;
  for (const notification of failed) {
    const domain = notification.shop.domain;
    const contractId = notification.contractId as string;
    const task = (() => {
      switch (notification.type) {
        case "SUBSCRIPTION_WELCOME":
          return sendSubscriptionWelcomeEmail(domain, contractId);
        case "RENEWAL_REMINDER": {
          const date = notification.key.split(":").at(-1) || "";
          return sendRenewalReminderEmail(domain, contractId, new Date(`${date}T12:00:00Z`));
        }
        case "PAYMENT_FAILED":
          return sendPaymentFailedEmail(domain, contractId, notification.key.split(`${domain}:`)[1] || "");
        case "STATUS_CHANGE": {
          const status = notification.key.split(":")[0].replace("status-", "").toUpperCase();
          const eventId = notification.key.split(`${contractId}:`)[1] || "";
          return sendStatusChangeEmail(domain, contractId, status, eventId);
        }
        default:
          return null;
      }
    })();
    if (!task) continue;
    const result = await task.catch(() => ({ sent: false }));
    if (result.sent) retried += 1;
  }
  return retried;
}

export async function recentEmails(shopDomain: string) {
  const shop = await ensureShop(shopDomain);
  const rows = await prisma.customerNotification.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status,
    recipient: row.recipient,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
  }));
}
