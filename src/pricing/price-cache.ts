import { existsSync, readFileSync, writeFileSync } from "fs";

export interface CacheEntry {
  priceMicroEur: bigint; // Euro price with 6 decimals
  dateKey: string; // "YYYY-MM-DD" UTC date key
  source: PriceSource;
  fetchedAt: number; // Milliseconds since epoch when fetched
}

export type PriceSource = "coingecko" | "frankfurter" | "par";

export type PriceCache = Record<string, CacheEntry>;

// Cache file path
const CACHE_FILE = "price_cache.json";

/** Load price cache from disk */
export function loadPriceCache(): PriceCache {
  if (!existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8"), reviver);
  } catch (error) {
    console.warn("Could not read price cache, starting fresh.");
    return {};
  }
}

/** Save price cache to disk */
export function saveCache(cache: PriceCache): void {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(cache, replacer, 2), "utf-8");
  } catch (error) {
    console.warn("Failed to save price cache:", (error as Error).message);
  }
}

/** JSON reviver/replacer so BigInt survives round-trip. */
const reviver = (_k: string, v: any) =>
  typeof v === "string" && /^-?\d+$/.test(v) ? BigInt(v) : v;
const replacer = (_k: string, v: any) =>
  typeof v === "bigint" ? v.toString() : v;

/** Build the `"ASSET:YYYY-MM-DD"` key */
function priceKey(currency: Currency, dateKey: string): string {
  return `${currency}:${dateKey}`;
}

/** Read a cached price (micro Euro) if present */
export function getCachedPrice(
  cache: PriceCache,
  currency: Currency,
  dateKey: string,
): CacheEntry | undefined {
  return cache[priceKey(currency, dateKey)];
}

/** Put a price entry into the in-memory cache. */
export function putCachedPrice(
  cache: PriceCache,
  currency: Currency,
  dateKey: string,
  entry: Omit<CacheEntry, "dateKey">,
) {
  cache[priceKey(currency, dateKey)] = { ...entry, dateKey };
}
