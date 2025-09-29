import { processTransactions } from "./stellar/process-transactions";
import { fetchTransactionsWithOps } from "./stellar/horizon";
import { writeCsvFile } from "./export/csv";
import { loadPriceCache, saveCache } from "./pricing/price-cache";
import { buildPriceBook } from "./pricing/price-service";

// Get transactions and calculate their taxes with first in first out
async function main() {
  const walletAddress = process.argv[2];

  const cache = loadPriceCache();

  if (!walletAddress) {
    console.error("Usage: tsx script.py.ts <stellar-wallet-address>");
    process.exit(1);
  }

  try {
    console.log(`Fetching transactions for wallet: ${walletAddress}`);

    const allTransactions =
      await fetchTransactionsWithOps(walletAddress);

    const txRows = processTransactions(allTransactions, walletAddress);

    const priceBook = await buildPriceBook(txRows, cache);

    writeCsvFile(txRows, priceBook)
  } catch (error) {
    console.error("Error:", (error as Error).message);
  } finally {
    saveCache(cache);
  }
}

if (require.main === module) {
  main();
}
