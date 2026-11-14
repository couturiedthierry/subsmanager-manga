import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

const lastInitialSync = new Map<string, number>();

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  // Installed on many stores (public or custom distribution), all managed from /control.
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    afterAuth: async ({ session, admin }) => {
      // Load the store's existing plans and subscriptions right after install or reauthorization.
      // Runs in the background so the merchant is not kept waiting, at most once an hour per store.
      const last = lastInitialSync.get(session.shop) || 0;
      if (Date.now() - last < 60 * 60 * 1000) return;
      lastInitialSync.set(session.shop, Date.now());
      void import("./models/control.server")
        .then(({ syncStoreSnapshot }) => syncStoreSnapshot(session.shop, admin))
        .then(async ({ shop }) => {
          const { syncStorefrontSettings } = await import("./models/storefront-settings.server");
          await syncStorefrontSettings(shop, admin);
        })
        .catch((error) => console.error(`Initial sync failed for ${session.shop}`, error));
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
