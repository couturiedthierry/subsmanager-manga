// Pure helpers shared by server code and page components (safe to load in the browser).

type Money = { amount: string; currencyCode: string };

export type ContractDetail = {
  id: string;
  status: string;
  currencyCode: string;
  nextBillingDate: string | null;
  lastPaymentStatus: string | null;
  customer: {
    id: string;
    displayName: string;
    defaultEmailAddress: { emailAddress: string } | null;
  } | null;
  originOrder: { id: string; name: string; createdAt: string } | null;
  billingPolicy: { interval: string; intervalCount: number };
  deliveryPolicy: { interval: string; intervalCount: number };
  deliveryPrice: Money;
  customerPaymentMethod: {
    id: string;
    revokedAt: string | null;
    instrument: {
      __typename: string;
      brand?: string;
      lastDigits?: string;
      expiryMonth?: number;
      expiryYear?: number;
      paypalAccountEmail?: string;
    } | null;
  } | null;
  lines: {
    nodes: Array<{
      id: string;
      title: string;
      variantTitle: string | null;
      quantity: number;
      productId: string | null;
      variantId: string | null;
      currentPrice: Money;
      lineDiscountedPrice: Money;
      variantImage: { url: string; altText: string | null } | null;
    }>;
  };
  billingAttempts: {
    nodes: Array<{
      id: string;
      createdAt: string;
      completedAt: string | null;
      ready: boolean;
      errorCode: string | null;
      errorMessage: string | null;
      order: { id: string; name: string } | null;
    }>;
  };
};

export function contractTotal(contract: Pick<ContractDetail, "lines">) {
  return contract.lines.nodes.reduce(
    (sum, line) => sum + Number(line.lineDiscountedPrice.amount) * line.quantity,
    0,
  );
}

export function paymentMethodLabel(contract: Pick<ContractDetail, "customerPaymentMethod"> | null) {
  const method = contract?.customerPaymentMethod;
  const instrument = method?.instrument;
  if (!method || !instrument) return "No payment method on file";
  const revoked = method.revokedAt ? " (revoked)" : "";
  if (instrument.paypalAccountEmail) return `PayPal · ${instrument.paypalAccountEmail}${revoked}`;
  const expiry = instrument.expiryMonth && instrument.expiryYear
    ? ` · exp ${String(instrument.expiryMonth).padStart(2, "0")}/${String(instrument.expiryYear).slice(-2)}`
    : "";
  return `${instrument.brand || "Card"} •••• ${instrument.lastDigits || "????"}${expiry}${revoked}`;
}

