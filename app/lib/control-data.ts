export type CachedLine = {
  title: string;
  quantity: number;
  lineDiscountedPrice: { amount: string; currencyCode: string };
};

export function parseContractLines(value: string): CachedLine[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as CachedLine[]) : [];
  } catch {
    return [];
  }
}

export function recurringValue(lines: CachedLine[]) {
  return lines.reduce(
    (sum, line) => sum + Number(line.lineDiscountedPrice?.amount || 0) * Number(line.quantity || 0),
    0,
  );
}
