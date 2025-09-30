export const STROOPS_PER_UNIT = 10_000_000n; // 7 decimal places
export const MICRO_PER_EUR = 1_000_000n; // 6 decimal places
const STROOPSxMICRO_PER_CENT = STROOPS_PER_UNIT * (MICRO_PER_EUR / 100n); // 10^11

export const DAY_IN_MS = 86_400_000;

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

export const valueCentsFromStroops = (
  amountStroops: bigint,
  priceMicro: bigint,
): bigint => {
  const num = amountStroops * priceMicro; // stroops * micro-EUR

  // round cents half-up. Supports negative numbers as well.
  if (num >= 0n) {
    return (num + STROOPSxMICRO_PER_CENT / 2n) / STROOPSxMICRO_PER_CENT;
  } else {
    return (num - STROOPSxMICRO_PER_CENT / 2n) / STROOPSxMICRO_PER_CENT;
  }
};

export const formatCents = (cents: bigint): string => {
  const sign = cents < 0n ? "-" : "";
  const abs = cents < 0n ? -cents : cents;
  const euros = abs / 100n;
  const rem = (abs % 100n).toString().padStart(2, "0");
  return `${sign}${euros},${rem}`;
};

/** Format a micro euro as string in full accuraccy */
export const formatPriceMicro = (micro: bigint): string => {
  // micro-EUR per 1 unit -> string with 6 decimals (comma)
  const i = micro / 1_000_000n;
  const frac = (micro % 1_000_000n).toString().padStart(6, "0");
  return `${i},${frac}`;
};
