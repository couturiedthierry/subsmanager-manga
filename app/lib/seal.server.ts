/**
 * Client for the Seal Subscriptions Merchant API.
 * Docs: https://www.sealsubscriptions.com/articles/merchant-api-documentation
 *
 * Seal is a Shopify subscription app that already has Shopify's approval for the subscription
 * APIs. When the store has Seal installed, SubsManager Manga can show and manage Seal's
 * subscriptions through this API while its own approval is pending (or instead of it).
 */

import type { SealRule, SealStatusFilter, SealSubscription } from "./seal-helpers";
export * from "./seal-helpers";

const SEAL_API_BASE = "https://app.sealsubscriptions.com/shopify/merchant/api";
const REQUEST_TIMEOUT_MS = 20_000;

export class SealApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "SealApiError";
    this.status = status;
  }
}

type SealResponse<T> = { success: boolean; payload?: T; error?: string; message?: string };


export class SealClient {
  constructor(private readonly token: string, private readonly fetchImpl: typeof fetch = fetch) {}

  private async request<T>(method: "GET" | "PUT" | "POST" | "DELETE", path: string, options: {
    query?: Record<string, string | number | undefined | null>;
    body?: unknown;
  } = {}): Promise<T> {
    const url = new URL(`${SEAL_API_BASE}${path}`);
    for (const [key, value] of Object.entries(options.query || {})) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    // Seal allows 10 requests at a time per key and answers 503 when that is exceeded,
    // so one short retry covers the common case of two staff members clicking at once.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method,
          headers: { "Content-Type": "application/json", "X-Seal-Token": this.token },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
          redirect: "follow",
        });
      } catch (error) {
        clearTimeout(timer);
        const aborted = error instanceof Error && error.name === "AbortError";
        throw new SealApiError(aborted ? "Seal did not answer in time. Try again." : "Could not reach Seal. Try again.", 0);
      }
      clearTimeout(timer);
      if (response.status === 503 && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      let data: SealResponse<T> | null = null;
      try {
        data = (await response.json()) as SealResponse<T>;
      } catch {
        data = null;
      }
      if (response.status === 401 || response.status === 403) {
        throw new SealApiError("Seal rejected the API token. Check that it was copied correctly and still exists in Seal.", response.status);
      }
      if (!response.ok || !data || data.success === false) {
        const detail = data?.error || data?.message || `Seal answered with status ${response.status}`;
        throw new SealApiError(typeof detail === "string" ? detail : "Seal could not complete the request", response.status);
      }
      return data.payload as T;
    }
    throw new SealApiError("Seal is busy right now. Try again in a moment.", 503);
  }

  listSubscriptions(options: { query?: string; cursor?: string | null; status?: SealStatusFilter } = {}) {
    return this.request<{ subscriptions: SealSubscription[]; next_cursor: string | null }>("GET", "/subscriptions", {
      query: {
        query: options.query,
        cursor: options.cursor,
        "with-items": "true",
        "with-billing-attempts": "true",
        "active-only": options.status === "ACTIVE" ? "true" : undefined,
        "paused-only": options.status === "PAUSED" ? "true" : undefined,
        "cancelled-only": options.status === "CANCELLED" ? "true" : undefined,
      },
    });
  }

  getSubscription(id: number | string) {
    return this.request<SealSubscription>("GET", "/subscription", { query: { id } });
  }

  updateSubscription(id: number, action: "pause" | "resume" | "cancel" | "reactivate" | "send_payment_method_update_email") {
    return this.request<unknown>("PUT", "/subscription", { body: { id, action } });
  }

  updateBillingAttempt(subscriptionId: number, attemptId: number, action: "skip" | "unskip") {
    return this.request<unknown>("PUT", "/subscription-billing-attempt", {
      body: { id: attemptId, subscription_id: subscriptionId, action },
    });
  }

  chargeNow(subscriptionId: number) {
    return this.request<unknown>("PUT", "/subscription-create-charge-now", { body: { id: subscriptionId } });
  }

  listRules(page = 1) {
    return this.request<{ subscription_rules: SealRule[]; page: number; total_pages: number }>("GET", "/subscription-rules", {
      query: { page },
    });
  }

  getRule(id: number) {
    return this.request<SealRule>("GET", "/subscription-rule", { query: { id } });
  }

  appendRuleProducts(ruleId: number, products: Array<{ product_id: string; variant_id: string | null }>) {
    return this.request<unknown>("PUT", "/subscription-rule/append-product-variants", {
      body: { id: ruleId, product_variants: products },
    });
  }

  replaceRuleProducts(ruleId: number, products: Array<{ product_id: string; variant_id: string | null }>) {
    return this.request<unknown>("PUT", "/subscription-rule", { body: { id: ruleId, product_variants: products } });
  }
}
