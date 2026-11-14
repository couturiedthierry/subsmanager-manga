export function formatMoney(
  amount: string | number | null | undefined,
  currencyCode = "USD",
) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currencyCode,
  }).format(Number(amount || 0));
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(value));
}

export function numericId(gid: string | null | undefined) {
  return gid?.split("/").at(-1) || "";
}

export function badgeTone(status: string) {
  switch (status.toUpperCase()) {
    case "ACTIVE":
    case "SUCCESS":
      return "success" as const;
    case "PAUSED":
    case "PENDING":
      return "warning" as const;
    case "CANCELLED":
    case "EXPIRED":
      return "neutral" as const;
    default:
      return "critical" as const;
  }
}
