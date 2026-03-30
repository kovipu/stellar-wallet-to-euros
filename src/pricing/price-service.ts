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
  // 1) Unique UTC date keys across all txs
  const dateKeys = Array.from(
    new Set(txRows.map((r) => dateKeyUTC(r.date))).values(),
  ).sort();

  // 2) Hydrate XLM once over the full range
  // await hydrateXlmRangeAround(dateKeys, cache);

  // 3) Ensure EURC & USDC exist for each day
  await Promise.all(
    dateKeys.map(async (dateKey) => {
      // EURC par (no network)
      if (!getCachedPrice(cache, "EURC", dateKey)) {
        putCachedPrice(cache, "EURC", dateKey, {
          priceMicroEur: MICRO_PER_EUR,
          source: "par",
          fetchedAt: Date.now(),
        });
      }

      // USDC via Frankfurter (cached per day)
      if (!getCachedPrice(cache, "USDC", dateKey)) {
        const micro = await fetchUsdToEurMicro(dateKey);
        putCachedPrice(cache, "USDC", dateKey, {
          priceMicroEur: micro,
          source: "frankfurter",
          fetchedAt: Date.now(),
        });
      }

      // XLM should already be present from hydration; as a safety net:
      if (!getCachedPrice(cache, "XLM", dateKey)) {
        await hydrateCoinGeckoRangeAround("XLM", dateKey, cache);
      }

      // BLND via CoinGecko
      if (!getCachedPrice(cache, "BLND", dateKey)) {
        await hydrateCoinGeckoRangeAround("BLND", dateKey, cache);
      }
    }),
  );

  // 4) Assemble book: all 4 assets × each day
  const book: PriceBook = {};
  for (const dk of dateKeys) {
    for (const c of ["XLM", "USDC", "EURC", "BLND"] as const) {
      const entry = getCachedPrice(cache, c, dk);
      if (!entry) throw new Error(`Missing ${c} price for ${dk}`);
      book[priceKey(c, dk)] = entry;
    }
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

  // XLM/BLND via CoinGecko (date range hydration first)
  await hydrateCoinGeckoRangeAround(currency, dateKey, cache);
  const maybe = getCachedPrice(cache, currency, dateKey);
  if (maybe !== undefined) return maybe;

  throw new Error(`${currency} price not found`);
}

const COINGECKO_IDS: Partial<Record<Currency, string>> = {
  XLM: "stellar",
  BLND: "blend",
};

/** Hydrate many days for a CoinGecko-listed coin in one call to avoid 429s. */
async function hydrateCoinGeckoRangeAround(
  currency: Currency,
  dateKey: string,
  cache: PriceCache,
  daysBack = 60,
  daysForward = 30,
): Promise<void> {
  if (getCachedPrice(cache, currency, dateKey) !== undefined) return;

  const coinId = COINGECKO_IDS[currency];
  if (!coinId) throw new Error(`No CoinGecko ID configured for ${currency}`);

  const [y, m, d] = dateKey.split("-").map(Number);
  const centerStartMs = Date.UTC(y, m - 1, d); // 00:00:00Z of that day
  const fromSec = Math.floor((centerStartMs - daysBack * DAY_IN_MS) / 1000);
  const toSec = Math.floor((centerStartMs + daysForward * DAY_IN_MS) / 1000);

  const url = new URL(
    `api/v3/coins/${coinId}/market_chart/range`,
    "https://api.coingecko.com/",
  );
  url.searchParams.set("vs_currency", "eur");
  url.searchParams.set("from", String(fromSec));
  url.searchParams.set("to", String(toSec));
  url.searchParams.set("x_cg_demo_api_key", process.env.COINGECKO_API_KEY!!);
  const res = await fetch(url);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`CoinGecko API error (${res.status}): ${errorText}`);
  }
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
    putCachedPrice(cache, currency, dk, {
      priceMicroEur: micro,
      source: "coingecko",
      fetchedAt: now,
    });
  }
}

/** Frankfurter (ECB) daily USD→EUR, returns micro-EUR per 1 USD (BigInt). */
export async function fetchUsdToEurMicro(dateKey: string): Promise<bigint> {
  const url = new URL(dateKey, "https://api.frankfurter.app/");
  url.searchParams.set("from", "USD");
  url.searchParams.set("to", "EUR");
  const res = await fetch(url);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Frankfurter API error (${res.status}): ${errorText}`);
  }
  const data = await res.json();
  const rate = data?.rates?.EUR;
  if (typeof rate !== "number") {
    throw new Error("Frankfurter: missing EUR rate");
  }
  // Convert to micro-EUR per USD (round half up)
  return BigInt(Math.round(rate * 1_000_000));
}
