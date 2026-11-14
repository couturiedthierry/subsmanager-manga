import { redirect } from "react-router";

// Public apps must start installation from a Shopify-owned surface. This route
// intentionally never asks merchants to type a shop domain.
export const loader = async () => redirect("/");

export const action = async () => redirect("/");

export default function AuthLogin() {
  return null;
}
