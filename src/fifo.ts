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
            currency: toCurrency(tx.asset_type, tx.asset_code),
          });
          break;
        case "path_payment_strict_send":
        case "path_payment_strict_receive":
          if (tx.to !== walletAddress) {
            // swap fee
            acc.transactions.push({
              transactionHash: tx.transaction_hash,
              date: new Date(tx.created_at),
              type: "swap_fee",
              fromAddress: tx.from,
              toAddress: tx.to,
              amountStroops: toStroops(tx.amount),
              currency: toCurrency(tx.source_asset_type, tx.source_asset_code),
            });
          } else {
            // swap
            acc.transactions.push({
              transactionHash: tx.transaction_hash,
              date: new Date(tx.created_at),
              type: "swap",
              sourceAmountStroops: toStroops(tx.source_amount),
              sourceCurrency: toCurrency(
                tx.source_asset_type,
                tx.source_asset_code,
              ),
              destinationAmountStroops: toStroops(tx.amount),
              destinationCurrency: toCurrency(tx.asset_type, tx.asset_code),
            });
          }
          break;
        case "invoke_host_function":
          const balanceChange = tx.asset_balance_changes[0];
          if (balanceChange.type !== "transfer") {
            throw new Error("Expected balance change to be a transfer");
          }
          acc.transactions.push({
            transactionHash: tx.transaction_hash,
            date: new Date(tx.created_at),
            type:
              balanceChange.from === walletAddress
                ? "blend_deposit"
                : "blend_withdraw",
            fromAddress: balanceChange.from,
            toAddress: balanceChange.to,
            amountStroops: toStroops(balanceChange.amount),
            currency: toCurrency(
              balanceChange.asset_type,
              balanceChange.asset_code,
            ),
          });
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
  const decimalPart = amountStr.slice(-7).padStart(7, "0");
  const integerPart = amountStr.slice(0, -7) || "0";
  return `${integerPart},${decimalPart}`;
};

const toCurrency = (
  assetType: string,
  assetCode: string | undefined,
): Currency => {
  if (assetType === "native") {
    return "XLM";
  }
  if (!assetCode) {
    throw new Error("Asset code is required");
  }
  return assetCode as Currency;
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
