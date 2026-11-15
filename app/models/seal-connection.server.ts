import prisma from "../db.server";
import { decryptSecret, encryptSecret } from "../lib/control-crypto.server";
import { SealApiError, SealClient } from "../lib/seal.server";
import { ensureShop } from "./shop.server";

/** Returns a Seal client for the store, or null when the store has not connected Seal. */
export async function getSealClient(shopDomain: string) {
  const shop = await prisma.shop.findUnique({
    where: { domain: shopDomain },
    select: { sealToken: true },
  });
  if (!shop?.sealToken) return null;
  try {
    return new SealClient(decryptSecret(shop.sealToken));
  } catch {
    // The token can't be read (for example the encryption key changed): treat as not connected.
    return null;
  }
}

export async function sealConnectionStatus(shopDomain: string) {
  const shop = await prisma.shop.findUnique({
    where: { domain: shopDomain },
    select: { sealToken: true, sealConnectedAt: true },
  });
  return {
    connected: Boolean(shop?.sealToken),
    connectedAt: shop?.sealConnectedAt?.toISOString() || null,
  };
}

/** Checks the token against Seal before saving it, so a typo never gets stored. */
export async function connectSeal(shopDomain: string, rawToken: string) {
  const token = rawToken.trim();
  if (!/^\S{20,200}$/.test(token)) {
    return { ok: false as const, error: "Paste the API token from Seal (Settings → General settings → API)." };
  }
  try {
    const client = new SealClient(token);
    const rules = await client.listRules(1);
    const shop = await ensureShop(shopDomain);
    await prisma.shop.update({
      where: { id: shop.id },
      data: { sealToken: encryptSecret(token), sealConnectedAt: new Date() },
    });
    return { ok: true as const, ruleCount: rules.subscription_rules.length };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof SealApiError ? error.message : "Could not check the token with Seal. Try again.",
    };
  }
}

export async function disconnectSeal(shopDomain: string) {
  const shop = await ensureShop(shopDomain);
  await prisma.shop.update({
    where: { id: shop.id },
    data: { sealToken: null, sealConnectedAt: null },
  });
}
