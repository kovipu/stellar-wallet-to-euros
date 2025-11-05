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
    new Set(txRows.map((r) => dateKeyUTC(r.date))).values()
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
        // fallback: tiny hydration around the missing day
        await hydrateXlmRangeAround(dateKey, cache);
      }
    })
  );

  // 4) Assemble book: all 3 assets × each day
  const book: PriceBook = {};
  for (const dk of dateKeys) {
    for (const c of ["XLM", "USDC", "EURC"] as const) {
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
  url.searchParams.set("x_cg_demo_api_key", process.env.COINGECKO_API_KEY!!);
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
