import { processTransactions } from "./stellar/process-transactions";
import { fetchTransactionsWithOps } from "./stellar/horizon";
import { writeTransactionsCsvFile } from "./export/transactions-csv";
import { loadPriceCache, saveCache } from "./pricing/price-cache";
import { buildPriceBook } from "./pricing/price-service";
import { computeFifoFills } from "./report/fifo";
import { writeInventoryCsvFile, writeEventsCsvFile } from "./export/fifo-csv";

// Get transactions and calculate their taxes with first in first out
async function main() {
  const walletAddress = process.argv[2];
  const endDateArg = process.argv[3];

  const cache = loadPriceCache();

  if (!walletAddress) {
    console.error("Usage: tsx main.ts <stellar-wallet-address> [end-date]");
    console.error("  end-date: Optional YYYY-MM-DD format (e.g., 2025-03-31)");
    process.exit(1);
  }

  // Parse and validate end date if provided
  let endDate: Date | undefined;
  if (endDateArg) {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(endDateArg)) {
      console.error(
        `Error: Invalid date format "${endDateArg}". Use YYYY-MM-DD format.`,
      );
      process.exit(1);
    }
    // Parse as end of day UTC
    endDate = new Date(`${endDateArg}T23:59:59.999Z`);
    if (isNaN(endDate.getTime())) {
      console.error(`Error: Invalid date "${endDateArg}".`);
      process.exit(1);
    }
  }

  try {
    console.log(`Fetching transactions for wallet: ${walletAddress}`);

    let allTransactions = await fetchTransactionsWithOps(walletAddress);

    // Filter by end date if provided
    if (endDate) {
      const beforeCount = allTransactions.length;
      allTransactions = allTransactions.filter(
        (txWithOps) => new Date(txWithOps.tx.created_at) <= endDate,
      );
      console.log(
        `Filtered to ${allTransactions.length} transactions (${beforeCount - allTransactions.length} excluded after ${endDateArg})`,
      );
    }

    // Log date range
    if (allTransactions.length > 0) {
      const firstDate = new Date(allTransactions[0].tx.created_at)
        .toISOString()
        .split("T")[0];
      const lastDate = new Date(
        allTransactions[allTransactions.length - 1].tx.created_at,
      )
        .toISOString()
        .split("T")[0];
      console.log(`Processing transactions from ${firstDate} to ${lastDate}`);
    } else {
      console.log("No transactions to process");
    }

    const txRows = processTransactions(allTransactions, walletAddress);

    const priceBook = await buildPriceBook(txRows, cache);

    const { fills, endingBatches } = computeFifoFills(txRows, priceBook);

    writeTransactionsCsvFile(txRows, priceBook, fills);
    writeInventoryCsvFile(endingBatches);
    writeEventsCsvFile(endingBatches, fills, txRows);
  } catch (error) {
    console.error("Error:", (error as Error).message);
  } finally {
    saveCache(cache);
  }
}

if (require.main === module) {
  main();
}
