import type { Config } from "@react-router/dev/config";

const appHost = process.env.SHOPIFY_APP_URL
  ? new URL(process.env.SHOPIFY_APP_URL).host
  : undefined;

export default {
  allowedActionOrigins: appHost ? [appHost] : [],
} satisfies Config;
