import { MICRO_PER_EUR } from "../domain/units";
import {
  PriceCache,
  getCachedPrice,
  putCachedPrice,
} from "../pricing/price-cache";
import {
  PriceBook,
  priceKey,
  fetchUsdToEurMicro,
  hydrateXlmRangeAround,
} from "../pricing/price-service";
import { valueCentsFromStroops } from "../domain/units";
import type { BlendDailyRow } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Call hydrateXlmRangeAround with retry on 429 and a pause between calls. */
async function hydrateXlmWithRetry(
  dk: string,
  cache: PriceCache,
): Promise<void> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await hydrateXlmRangeAround(dk, cache);
      // Pause after a successful call so the next one doesn't 429
      await sleep(2000);
      return;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("429") && attempt < 4) {
        const delay = 5000 * attempt; // 5s, 10s, 15s
        console.warn(`  CoinGecko 429, waiting ${delay / 1000}s...`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
}

/**
 * Build a PriceBook covering all dates and currencies present in the rows.
 * Reuses the existing price cache to avoid redundant network calls.
 */
export async function buildBlendPriceBook(
  rows: ReadonlyArray<BlendDailyRow>,
  cache: PriceCache,
): Promise<PriceBook> {
  const dateKeys = Array.from(new Set(rows.map((r) => r.date))).sort();
  const currencies = Array.from(
    new Set(rows.map((r) => r.currency)),
  ) as Currency[];

  // EURC: par value, no network call
  if (currencies.includes("EURC")) {
    for (const dk of dateKeys) {
      if (!getCachedPrice(cache, "EURC", dk)) {
        putCachedPrice(cache, "EURC", dk, {
          priceMicroEur: MICRO_PER_EUR,
          source: "par",
          fetchedAt: Date.now(),
        });
      }
    }
  }

  // XLM: CoinGecko range hydration (~90 days per call, with rate-limit handling)
  if (currencies.includes("XLM")) {
    for (const dk of dateKeys) {
      if (!getCachedPrice(cache, "XLM", dk)) {
        await hydrateXlmWithRetry(dk, cache);
      }
    }
  }

  // USDC: Frankfurter ECB rate, one date at a time
  if (currencies.includes("USDC")) {
    for (const dk of dateKeys) {
      if (!getCachedPrice(cache, "USDC", dk)) {
        const micro = await fetchUsdToEurMicro(dk);
        putCachedPrice(cache, "USDC", dk, {
          priceMicroEur: micro,
          source: "frankfurter",
          fetchedAt: Date.now(),
        });
      }
    }
  }

  // Assemble PriceBook
  const book: PriceBook = {};
  for (const dk of dateKeys) {
    for (const c of currencies) {
      const entry = getCachedPrice(cache, c, dk);
      if (!entry) throw new Error(`Missing ${c} price for ${dk}`);
      book[priceKey(c, dk)] = entry;
    }
  }
  return book;
}

/**
 * Fill EUR valuation fields on each row using the price book.
 * Mutates the rows in place.
 */
export function applyPrices(rows: BlendDailyRow[], book: PriceBook): void {
  let cumulativeYieldEurCents = 0n;
  let prevPositionKey = "";

  for (const row of rows) {
    const positionKey = `${row.poolId}:${row.assetAddress}`;
    if (positionKey !== prevPositionKey) {
      cumulativeYieldEurCents = 0n;
      prevPositionKey = positionKey;
    }

    const entry = book[priceKey(row.currency, row.date)];
    if (!entry) {
      throw new Error(`Missing price for ${row.currency} on ${row.date}`);
    }

    row.priceEurMicro = entry.priceMicroEur;
    row.balanceEurCents = valueCentsFromStroops(
      row.balanceStroops,
      entry.priceMicroEur,
    );
    row.yieldEurCents = valueCentsFromStroops(
      row.yieldStroops,
      entry.priceMicroEur,
    );
    cumulativeYieldEurCents += row.yieldEurCents;
    row.cumulativeYieldEurCents = cumulativeYieldEurCents;
  }
}
