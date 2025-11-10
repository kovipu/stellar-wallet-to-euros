import { processTransactions } from "./stellar/process-transactions";
import { fetchTransactionsWithOps } from "./stellar/horizon";
import { writeTransactionsCsvFile } from "./export/transactions-csv";
import { loadPriceCache, saveCache } from "./pricing/price-cache";
import { buildPriceBook } from "./pricing/price-service";
import { computeFifoFills } from "./report/fifo";
import { writeFillsCsvFile, writeInventoryCsvFile } from "./export/fifo-csv";

// Get transactions and calculate their taxes with first in first out
async function main() {
  const walletAddress = process.argv[2];

  const cache = loadPriceCache();

  if (!walletAddress) {
    console.error("Usage: tsx main.ts <stellar-wallet-address>");
    process.exit(1);
  }

  try {
    console.log(`Fetching transactions for wallet: ${walletAddress}`);

    const allTransactions =
      await fetchTransactionsWithOps(walletAddress);

    const txRows = await processTransactions(allTransactions, walletAddress);

    const priceBook = await buildPriceBook(txRows, cache);

    const { fills, endingBatches } = computeFifoFills(txRows, priceBook)

    writeTransactionsCsvFile(txRows, priceBook, fills)
    writeFillsCsvFile(fills)
    writeInventoryCsvFile(endingBatches)
  } catch (error) {
    console.error("Error:", (error as Error).message);
  } finally {
    saveCache(cache);
  }
}

if (require.main === module) {
  main();
}
