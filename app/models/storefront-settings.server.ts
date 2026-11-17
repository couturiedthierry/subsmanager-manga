import type { Shop } from "@prisma/client";
import prisma from "../db.server";
import type { AdminGraphqlClient } from "../lib/graphql.server";
import { graphqlRequest, throwOnUserErrors } from "../lib/graphql.server";
import { CREATE_SETTINGS_DEFINITION, SET_METAFIELDS, SHOP_ID_QUERY } from "../lib/shopify-queries";
import { parseStoredWidget, widgetClassList, widgetStyleAttribute } from "../lib/widget-settings";

/**
 * The storefront and customer-portal switches are stored on the shop as a JSON metafield.
 * The theme block reads it with Liquid (shop.metafields.subsmanager.settings) and the
 * customer-account extensions read it through the Customer Account API, so the
 * definition grants storefront and customer-account read access.
 */
export const SETTINGS_NAMESPACE = "subsmanager";
export const SETTINGS_KEY = "settings";

export function storefrontPayload(shop: Shop) {
  const widget = parseStoredWidget(shop.widgetSettings);
  return {
    productWidget: shop.showProductWidget,
    // Design and texts of the product-page widget (Widget page). style and classes are
    // pre-built here so the theme block only prints validated values.
    widget: { ...widget, style: widgetStyleAttribute(widget), classes: widgetClassList(widget) },
    portal: {
      enabled: shop.portalEnabled,
      pause: shop.portalAllowPause,
      skip: shop.portalAllowSkip,
      cancel: shop.portalAllowCancel,
      payment: shop.portalAllowPayment,
    },
    supportEmail: shop.supportEmail || null,
  };
}

type UserErrors = Array<{ field?: string[] | null; message: string; code?: string | null }>;

async function ensureDefinition(admin: AdminGraphqlClient) {
  const data = await graphqlRequest<{ metafieldDefinitionCreate: { userErrors: UserErrors } }>(
    admin,
    CREATE_SETTINGS_DEFINITION,
    {
      definition: {
        name: "SubsManager Manga storefront settings",
        description: "Controls the product-page subscription options and the customer subscription portal.",
        namespace: SETTINGS_NAMESPACE,
        key: SETTINGS_KEY,
        ownerType: "SHOP",
        type: "json",
        access: { storefront: "PUBLIC_READ", customerAccount: "READ" },
      },
    },
  );
  // TAKEN means the definition already exists, which is fine.
  const errors = data.metafieldDefinitionCreate.userErrors.filter((error) => error.code !== "TAKEN");
  throwOnUserErrors(errors);
}

/** Publishes the store's switches to Shopify. Records the outcome on the shop. */
export async function syncStorefrontSettings(shop: Shop, admin: AdminGraphqlClient) {
  try {
    await ensureDefinition(admin);
    const { shop: shopInfo } = await graphqlRequest<{ shop: { id: string } }>(admin, SHOP_ID_QUERY);
    const data = await graphqlRequest<{ metafieldsSet: { userErrors: UserErrors } }>(admin, SET_METAFIELDS, {
      metafields: [
        {
          ownerId: shopInfo.id,
          namespace: SETTINGS_NAMESPACE,
          key: SETTINGS_KEY,
          type: "json",
          value: JSON.stringify(storefrontPayload(shop)),
        },
      ],
    });
    throwOnUserErrors(data.metafieldsSet.userErrors);
    await prisma.shop.update({
      where: { id: shop.id },
      data: { storefrontSyncedAt: new Date(), storefrontSyncError: null },
    });
    return { ok: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not publish storefront settings";
    await prisma.shop.update({
      where: { id: shop.id },
      data: { storefrontSyncError: message.slice(0, 500) },
    });
    return { ok: false as const, error: message };
  }
}
