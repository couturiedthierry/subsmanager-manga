import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { isRouteErrorResponse, Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Dashboard</s-link>
        <s-link href="/app/plans">Plans</s-link>
        <s-link href="/app/subscriptions">Subscriptions</s-link>
        <s-link href="/app/analytics">Analytics</s-link>
        <s-link href="/app/widget">Widget</s-link>
        <s-link href="/app/seal">Seal</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
// Any other unexpected error gets a readable page instead of an empty error box.
export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) || error instanceof Response) return boundary.error(error);
  return (
    <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", padding: "32px", maxWidth: 640 }}>
      <h1 style={{ fontSize: 20, margin: "0 0 12px" }}>This page couldn’t load</h1>
      <p style={{ lineHeight: 1.5, margin: "0 0 12px" }}>
        Something went wrong while loading SubsManager Manga. Reload the page to try again.
      </p>
      <p style={{ lineHeight: 1.5, margin: 0, color: "#616161" }}>
        If it keeps happening, contact support and mention the time it happened.
      </p>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
