export const STROOPS_PER_UNIT = 10_000_000n; // 7 decimal places

export const toCurrency = (
  assetType: string,
  assetCode: string | undefined,
): Currency => {
  if (assetType === "native") return "XLM";
  if (!assetCode) throw new Error("Asset code is required");
  return assetCode as Currency;
};

// Convert amount to BigInt stroops.
export const toStroops = (raw: string): bigint => {
  // Remove commas first
  const cleanAmount = raw.replace(",", "");

  // Split by decimal point
  const parts = cleanAmount.split(".");

  if (parts.length === 1) {
    // No decimal point - this is already in stroops (like fees from API)
    return BigInt(parts[0]);
  } else if (parts.length === 2) {
    // Has decimal point - convert from XLM to stroops
    const integerPart = parts[0];
    const decimalPart = parts[1].padEnd(7, "0").slice(0, 7); // Pad to 7 digits and truncate if longer

    return BigInt(integerPart) * STROOPS_PER_UNIT + BigInt(decimalPart);
  } else {
    throw new Error(`Invalid amount format: ${raw}`);
  }
};

export const toDecimal = (stroops: bigint): string => {
  const amountStr = stroops.toString();
  const decimalPart = amountStr.slice(-7).padStart(7, "0");
  const integerPart = amountStr.slice(0, -7) || "0";
  return `${integerPart},${decimalPart}`;
};
