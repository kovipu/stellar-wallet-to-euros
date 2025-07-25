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

    const snapshot = transactions.slice(0, 5);
    console.log(snapshot);

    const output = await processTransactions(snapshot, walletAddress);
    exportToCsv(output);
  } catch (error) {
    console.error("Error:", (error as Error).message);
  }
}

type Output = {
  transactions: Transaction[];
};

type Transaction = WalletTransaction | SwapTransaction;

type Currency = "XLM" | "USDC" | "EURC";

type WalletTransaction = {
  transactionHash: string;
  date: Date;
  type:
    | "create_account"
    | "payment_received"
    | "payment_sent"
    | "swap_fee"
    | "blend_deposit"
    | "blend_withdraw";
  fromAddress: string;
  toAddress: string;
  amountStroops: BigInt;
  currency: Currency;
};

type SwapTransaction = {
  transactionHash: string;
  date: Date;
  type: "swap";
  sourceAmountStroops: BigInt;
  sourceCurrency: Currency;
  destinationAmountStroops: BigInt;
  destinationCurrency: Currency;
};

export async function processTransactions(
  transactions: Horizon.ServerApi.OperationRecord[],
  walletAddress: string,
): Promise<Output> {
  // Take the incoming transactions, and increment that currency's account's balance
  return transactions.reduce(
    (acc, tx) => {
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
        case "payment":
          acc.transactions.push({
            transactionHash: tx.transaction_hash,
            date: new Date(tx.created_at),
            type: tx.to === walletAddress ? "payment_received" : "payment_sent",
            fromAddress: tx.from,
            toAddress: tx.to,
            amountStroops: toStroops(tx.amount),
            currency:
              tx.asset_type === "native" ? "XLM" : (tx.asset_code as Currency),
          });
          break;
        case "path_payment_strict_send":
          if (tx.to !== walletAddress) {
            // swap fee
            acc.transactions.push({
              transactionHash: tx.transaction_hash,
              date: new Date(tx.created_at),
              type: "swap_fee",
              fromAddress: tx.from,
              toAddress: tx.to,
              amountStroops: toStroops(tx.amount),
              currency:
                tx.source_asset_type === "native"
                  ? "XLM"
                  : (tx.source_asset_code as Currency),
            });
          } else {
            // swap
            acc.transactions.push({
              transactionHash: tx.transaction_hash,
              date: new Date(tx.created_at),
              type: "swap",
              sourceAmountStroops: toStroops(tx.source_amount),
              sourceCurrency:
                tx.source_asset_type === "native"
                  ? "XLM"
                  : (tx.source_asset_code as Currency),
              destinationAmountStroops: toStroops(tx.destination_min),
              destinationCurrency:
                tx.asset_type === "native"
                  ? "XLM"
                  : (tx.asset_code as Currency),
            });
          }
          break;
        default:
          throw new Error(`Unknown transaction type: ${tx.type}`);
      }
      return acc;
    },
    { transactions: [] } as Output,
  );
}

// Convert amount to BigInt stroops.
const toStroops = (amount: string): BigInt => {
  return BigInt(amount.replace(".", "").replace(",", ""));
};

const toDecimal = (amount: BigInt): string => {
  const amountStr = amount.toString();
  const decimalPart = amountStr.slice(-7);
  const integerPart = amountStr.slice(0, -7);
  return `${integerPart},${decimalPart}`;
};

const exportToCsv = (output: Output) => {
  const outputCsv = stringify(
    output.transactions.map((tx) => {
      if (tx.type === "swap") {
        return {
          Date: tx.date.toISOString(),
          Type: tx.type,
          Amount: toDecimal(tx.destinationAmountStroops),
          Currency: tx.destinationCurrency,
          SourceAmount: toDecimal(tx.sourceAmountStroops),
          SourceCurrency: tx.sourceCurrency,
        };
      } else {
        return {
          Date: tx.date.toISOString(),
          Type: tx.type,
          Amount: toDecimal(tx.amountStroops),
          Currency: tx.currency,
          From: tx.fromAddress,
          To: tx.toAddress,
        };
      }
    }),
    {
      header: true,
      columns: [
        "Date",
        "Type",
        "Amount",
        "Currency",
        "SourceAmount",
        "SourceCurrency",
        "From",
        "To",
      ],
    },
  );
  console.log(outputCsv);
};

if (require.main === module) {
  main();
}
