import { loadPriceCache, saveCache } from "./pricing/price-cache";
import {
  loadSmoothieCache,
  saveSmoothieCache,
  disableSmoothieCache,
  fetchBlendSnapshot,
  fetchBalanceHistory,
  fetchApyHistory,
  fetchUserActions,
} from "./blend/smoothie-client";
import { calculateDailyYields } from "./blend/yield-calculator";
import { buildBlendPriceBook, applyPrices } from "./blend/blend-price-service";
import { writeBlendCsvFile, writeBlendChartCsvFile } from "./export/blend-csv";
import type { BlendDailyRow, BlendPosition } from "./blend/types";

function parseArgs(): { wallet: string; days: number; noCache: boolean } {
  const args = process.argv.slice(2);
  let wallet = "";
  let days = 365;
  let noCache = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--days" && args[i + 1]) {
      days = parseInt(args[i + 1], 10);
      if (isNaN(days) || days < 1) {
        console.error("--days must be a positive integer");
        process.exit(1);
      }
      i++;
    } else if (args[i] === "--no-cache") {
      noCache = true;
    } else if (!wallet) {
      wallet = args[i];
    }
  }

  if (!wallet) {
    console.error(
      "Usage: npm run blend -- <wallet-address> [--days N] [--no-cache]",
    );
    process.exit(1);
  }

  return { wallet, days, noCache };
}

async function main() {
  const { wallet, days, noCache } = parseArgs();

  console.log(`Blend P&L for ${wallet} (${days} days)`);

  // Load caches
  const priceCache = loadPriceCache();
  loadSmoothieCache();
  if (noCache) {
    disableSmoothieCache();
    console.log("  Smoothie cache disabled (--no-cache)");
  }

  try {
    // 1. Discover positions
    console.log("Discovering positions...");
    const positions = await fetchBlendSnapshot(wallet);
    if (positions.length === 0) {
      console.log("No positions found.");
      return;
    }
    for (const p of positions) {
      console.log(`  ${p.poolName} / ${p.currency}`);
    }

    // 2. Fetch data for all positions in parallel
    console.log("Fetching data...");
    const userActions = await fetchUserActions(wallet);

    // Fetch balance history per unique asset (API returns data for all pools)
    const uniqueAssets = Array.from(
      new Set(positions.map((p) => p.assetAddress)),
    );
    const balanceHistoryByAsset = new Map<
      string,
      Awaited<ReturnType<typeof fetchBalanceHistory>>
    >();
    await Promise.all(
      uniqueAssets.map(async (asset) => {
        const history = await fetchBalanceHistory(wallet, asset, days);
        balanceHistoryByAsset.set(asset, history);
      }),
    );

    // Fetch APY history per position
    const apyHistoryByPosition = new Map<
      string,
      Awaited<ReturnType<typeof fetchApyHistory>>
    >();
    await Promise.all(
      positions.map(async (p) => {
        const key = `${p.poolId}:${p.assetAddress}`;
        const history = await fetchApyHistory(p.poolId, p.assetAddress, days);
        apyHistoryByPosition.set(key, history);
      }),
    );

    // 3. Calculate daily yields per position
    console.log("Calculating yields...");
    const allRows: BlendDailyRow[] = [];
    for (const position of positions) {
      const balanceHistory =
        balanceHistoryByAsset.get(position.assetAddress) ?? [];
      const apyHistory =
        apyHistoryByPosition.get(
          `${position.poolId}:${position.assetAddress}`,
        ) ?? [];
      const rows = calculateDailyYields(
        position,
        balanceHistory,
        userActions,
        apyHistory,
      );
      allRows.push(...rows);
    }

    if (allRows.length === 0) {
      console.log("No balance history found for any position.");
      return;
    }

    // 4. Build price book and apply EUR valuations
    console.log("Fetching EUR prices...");
    const book = await buildBlendPriceBook(allRows, priceCache);
    applyPrices(allRows, book);

    // 5. Sort: by pool+currency, then date
    allRows.sort((a, b) => {
      const posA = `${a.poolName}:${a.currency}`;
      const posB = `${b.poolName}:${b.currency}`;
      if (posA !== posB) return posA.localeCompare(posB);
      return a.date.localeCompare(b.date);
    });

    // 6. Write CSVs
    writeBlendCsvFile(allRows);
    writeBlendChartCsvFile(allRows);
  } finally {
    saveCache(priceCache);
    saveSmoothieCache();
  }
}

main().catch((error) => {
  console.error("Error:", (error as Error).message);
  process.exit(1);
});
