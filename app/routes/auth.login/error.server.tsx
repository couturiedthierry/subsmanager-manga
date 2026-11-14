import type { LoginError } from "@shopify/shopify-app-react-router/server";
import { LoginErrorType } from "@shopify/shopify-app-react-router/server";

interface LoginErrorMessage {
  shop?: string;
}

export function loginErrorMessage(loginErrors: LoginError): LoginErrorMessage {
  if (loginErrors?.shop === LoginErrorType.MissingShop) {
    return { shop: "Open SubsManager Manga from Shopify Admin to continue" };
  } else if (loginErrors?.shop === LoginErrorType.InvalidShop) {
    return { shop: "Return to Shopify Admin and open the app again" };
  }

  return {};
}
