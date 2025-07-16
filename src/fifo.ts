import { Horizon } from "@stellar/stellar-sdk";
import { stringify } from "csv-stringify/sync";

const horizonServer = new Horizon.Server("https://horizon.stellar.org");

// Get transactions and calculate their taxes with first in first out
async function main() {
  const walletAddress = process.argv[2];

  if (!walletAddress) {
    console.error("Usage: tsx script.py.ts <stellar-wallet-address>");
    process.exit(1);
  }

  try {
    console.log(`Fetching transactions for wallet: ${walletAddress}`);
    const { records: transactions } = await horizonServer
      .payments()
      .forAccount(walletAddress)
      .limit(200)
      .order("asc")
      .call();

    const output = await processTransactions(transactions, walletAddress);
    exportToCsv(output);
  } catch (error) {
    console.error("Error:", (error as Error).message);
  }
}

type Output = {
  transactions: WalletTransaction[];
};

type Currency = "XLM" | "USDC" | "EURC";

type WalletTransaction = {
  transactionHash: string;
  date: Date;
  type:
    | "create_account"
    | "payment"
    | "swap"
    | "swap_fee"
    | "blend_deposit"
    | "blend_withdraw";
  fromAddress: string;
  toAddress: string;
  amountStroops: BigInt;
  currency: Currency;
};

export async function processTransactions(
  transactions: Horizon.ServerApi.OperationRecord[],
  walletAddress: string,
): Output {
  // Take the incoming transactions, and increment that currency's account's balance
  return transactions.reduce((acc, tx) => {
    switch (tx.type) {
      case "create_account":
        acc.transactions.push({
          transactionHash: tx.transaction_hash,
          date: new Date(tx.created_at),
          type: "create_account",
          fromAddress: tx.funder,
          toAddress: walletAddress,
          amountStroops: toStroops(tx.starting_balance),
          currency: "XLM",
        });
        break;
    }
    return acc;
  }, { transactions: [] } as Output);
}

if (require.main === module) {
  main();
}

// Convert amount to BigInt stroops.
const toStroops = (amount: string): BigInt => {
  return BigInt(amount.replace(".", "").replace(",", ""));
}

const exportToCsv = (output: Output) => {
  const outputCsv = stringify(
    output.transactions.map(tx => ({
      "Date": tx.date.toISOString(),
      "Type": tx.type,
      "From": tx.fromAddress,
      "To": tx.toAddress,
      "Amount": tx.amountStroops,
      "Currency": tx.currency,
    })),
    {
      header: true,
      columns: [
        "Date",
        "Type",
        "From",
        "To",
        "Amount",
        "Currency",
      ],
    }
  );
  console.log(outputCsv);
}