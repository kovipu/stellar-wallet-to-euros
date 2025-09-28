import { processTransactions } from "./stellar/process-transactions";
import { fetchTransactionsWithOps } from "./stellar/horizon";
import { exportToCsv } from "./export/csv";

// Get transactions and calculate their taxes with first in first out
async function main() {
  const walletAddress = process.argv[2];

  if (!walletAddress) {
    console.error("Usage: tsx script.py.ts <stellar-wallet-address>");
    process.exit(1);
  }

  try {
    console.log(`Fetching transactions for wallet: ${walletAddress}`);

    const allTransactions =
      await fetchTransactionsWithOps(walletAddress);

    const txRows = processTransactions(allTransactions, walletAddress);
    exportToCsv(txRows);
  } catch (error) {
    console.error("Error:", (error as Error).message);
  }
}

if (require.main === module) {
  main();
}
