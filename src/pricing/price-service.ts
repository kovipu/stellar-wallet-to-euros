import { DAY_IN_MS, MICRO_PER_EUR, STROOPS_PER_UNIT } from "../domain/units";
import { dateKeyUTC } from "./date-keys";
import {
  CacheEntry,
  getCachedPrice,
  PriceCache,
  putCachedPrice,
} from "./price-cache";

export type PriceBook = Record<string, CacheEntry>;

export const priceKey = (currency: Currency, dateKey: string) =>
  `${currency}:${dateKey}`;

export async function buildPriceBook(
  txRows: ReadonlyArray<TxRow>,
  cache: PriceCache,
): Promise<PriceBook> {
  // Collect unique (asset, day) pairs we actually need prices for (skip dust).
  const neededPrices = new Set<string>();

  for (const { date, feeStroops, ops } of txRows) {
    const dateKey = dateKeyUTC(date);
    if (feeStroops > 0n) neededPrices.add(priceKey("XLM", dateKey));

    for (const op of ops) {
      if (op.kind === "create_account") {
        neededPrices.add(priceKey("XLM", dateKey));
      } else if (op.kind === "payment") {
        neededPrices.add(priceKey(op.currency, dateKey));
      } else if (op.kind == "swap") {
        neededPrices.add(priceKey(op.sourceCurrency, dateKey));
        neededPrices.add(priceKey(op.destinationCurrency, dateKey));
      } else if (op.kind === "blend_deposit" || op.kind === "blend_withdraw") {
        neededPrices.add(priceKey(op.currency, dateKey));
      }
    }
  }

  // Fetch & assemble
  const book: PriceBook = {};
  for (const key of neededPrices) {
    const [currency, dateKey] = key.split(":") as [Currency, string];
    book[key] = await priceMicroEUR(currency, dateKey + "T00:00:00Z", cache);
  }
  return book;
}

/**
 * Get Euro price for an asset on the UTC day of `whenISO` as micro-Euro (BigInt)
 * - EURC: 1.0000000 Euro hardcoded
 * - USDC: Frankfuter (ECB) USD -> EUR
 * - XLM : CoinGecko daily price
 */
export async function priceMicroEUR(
  currency: Currency,
  whenISO: string,
  cache: PriceCache,
): Promise<CacheEntry> {
  const dateKey = dateKeyUTC(whenISO);

  const cacheHit = getCachedPrice(cache, currency, dateKey);
  if (cacheHit !== undefined) {
    return cacheHit;
  }

  if (currency === "EURC") {
    const newPrice: CacheEntry = {
      priceMicroEur: MICRO_PER_EUR,
      source: "par",
      dateKey,
      fetchedAt: Date.now(),
    };
    putCachedPrice(cache, currency, dateKey, newPrice);
    return newPrice;
  }

  if (currency === "USDC") {
    const newPrice: CacheEntry = {
      priceMicroEur: await fetchUsdToEurMicro(dateKey),
      source: "frankfurter",
      dateKey,
      fetchedAt: Date.now(),
    };
    putCachedPrice(cache, currency, dateKey, newPrice);
    return newPrice;
  }

  // XLM via CoinGecko (date range hydration first)
  await hydrateXlmRangeAround(dateKey, cache);
  const maybe = getCachedPrice(cache, "XLM", dateKey);
  if (maybe !== undefined) return maybe;

  // this should be very rare: need to fallback to single-day endpoint
  throw new Error("XLM price not found");
}

/** Hydrate many XLM days in one CoinGecko call to avoid 429s. */
async function hydrateXlmRangeAround(
  dateKey: string,
  cache: PriceCache,
  daysBack = 60,
  daysForward = 30,
): Promise<void> {
  if (getCachedPrice(cache, "XLM", dateKey) !== undefined) return;

  const [y, m, d] = dateKey.split("-").map(Number);
  const centerStartMs = Date.UTC(y, m - 1, d); // 00:00:00Z of that day
  const fromSec = Math.floor((centerStartMs - daysBack * DAY_IN_MS) / 1000);
  const toSec = Math.floor((centerStartMs + daysForward * DAY_IN_MS) / 1000);

  // const url = `https://api.coingecko.com/api/v3/coins/stellar/market_chart/range?vs_currency=eur&from=${fromSec}&to=${toSec}`;
  const url = new URL(
    "api/v3/coins/stellar/market_chart/range",
    "https://api.coingecko.com/",
  );
  url.searchParams.set("vs_currency", "eur");
  url.searchParams.set("from", String(fromSec));
  url.searchParams.set("to", String(toSec));
  const res = await fetch(url);
  const data = await res.json();
  const prices: [number, number][] = data?.prices ?? [];

  // store the last price seen per UTC day (micro-EUR)
  const map = new Map<string, bigint>();
  for (const [ms, eur] of prices) {
    if (typeof eur !== "number") continue;
    const dk = dateKeyUTC(new Date(ms));
    map.set(dk, BigInt(Math.round(eur * 1_000_000)));
  }

  const now = Date.now();
  for (const [dk, micro] of map) {
    putCachedPrice(cache, "XLM", dk, {
      priceMicroEur: micro,
      source: "coingecko",
      fetchedAt: now,
    });
  }
}

/** Frankfurter (ECB) daily USD→EUR, returns micro-EUR per 1 USD (BigInt). */
async function fetchUsdToEurMicro(dateKey: string): Promise<bigint> {
  const url = new URL(dateKey, "https://api.frankfurter.app/");
  url.searchParams.set("from", "USD");
  url.searchParams.set("to", "EUR");
  const res = await fetch(url);
  const data = await res.json();
  const rate = data?.rates?.EUR;
  if (typeof rate !== "number") {
    throw new Error("Frankfurter: missing EUR rate");
  }
  // Convert to micro-EUR per USD (round half up)
  return BigInt(Math.round(rate * 1_000_000));
}
