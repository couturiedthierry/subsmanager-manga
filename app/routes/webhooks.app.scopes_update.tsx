import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const current = Array.isArray(payload.current) ? payload.current.map(String) : [];
  await db.session.updateMany({
    where: { shop },
    data: { scope: current.join(",") },
  });

  return new Response();
};
