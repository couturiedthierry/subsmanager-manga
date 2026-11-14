import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  assertControlOrigin,
  authenticateStaff,
  createControlSession,
} from "../lib/control-auth.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  assertControlOrigin(request);
  const formData = await request.formData();
  const email = String(formData.get("email") || "");
  const password = String(formData.get("password") || "");
  const user = await authenticateStaff(email, password, request);

  if (!user) {
    throw redirect("/control/login?error=invalid", { status: 303 });
  }

  return createControlSession(user, request);
};
