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

    const res = await horizonServer
      .payments()
      .forAccount(walletAddress)
      .limit(200)
      .order("asc")
      .call();

    // TODO: proper pagination
    const res2 = await res.next();

    const allTransactions = [...res.records, ...res2.records];

    const output = await processTransactions(allTransactions, walletAddress);
    exportToCsv(output);
  } catch (error) {
    console.error("Error:", (error as Error).message);
  }
}

type Output = {
  transactions: Transaction[];
  balances: Balances;
};

type Balances = Record<Currency, BigInt>;

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
  balances: Balances;
};

type SwapTransaction = {
  transactionHash: string;
  date: Date;
  type: "swap";
  sourceAmountStroops: BigInt;
  sourceCurrency: Currency;
  destinationAmountStroops: BigInt;
  destinationCurrency: Currency;
  balances: Balances;
};

export async function processTransactions(
  transactions: Horizon.ServerApi.OperationRecord[],
  walletAddress: string,
): Promise<Output> {
  // Take the incoming transactions, and increment that currency's account's balance
  return transactions.reduce(
    (acc, tx) => {
      if (tx.type === "create_account") {
        acc.balances["XLM"] = toStroops(tx.starting_balance);
        acc.transactions.push({
          transactionHash: tx.transaction_hash,
          date: new Date(tx.created_at),
          type: "create_account",
          fromAddress: tx.funder,
          toAddress: walletAddress,
          amountStroops: toStroops(tx.starting_balance),
          currency: "XLM",
          balances: structuredClone(acc.balances),
        });
      } else if (tx.type === "payment") {
        const currency = toCurrency(tx.asset_type, tx.asset_code);
        if (tx.to === walletAddress) {
          acc.balances[currency] += toStroops(tx.amount);
        } else {
          acc.balances[currency] -= toStroops(tx.amount);
        }
        acc.transactions.push({
          transactionHash: tx.transaction_hash,
          date: new Date(tx.created_at),
          type: tx.to === walletAddress ? "payment_received" : "payment_sent",
          fromAddress: tx.from,
          toAddress: tx.to,
          amountStroops: toStroops(tx.amount),
          currency,
          balances: structuredClone(acc.balances),
        });
      } else if (
        tx.type === "path_payment_strict_send" ||
        tx.type === "path_payment_strict_receive"
      ) {
        if (tx.to !== walletAddress) {
          // swap fee
          const currency = toCurrency(
            tx.source_asset_type,
            tx.source_asset_code,
          );
          const amountStroops = toStroops(tx.source_amount);
          console.log("prev balance", acc.balances[currency]);
          acc.balances[currency] -= amountStroops;
          console.log({
            date: tx.created_at,
            amountStroops,
            currency,
            balances: acc.balances,
          });
          acc.transactions.push({
            transactionHash: tx.transaction_hash,
            date: new Date(tx.created_at),
            type: "swap_fee",
            fromAddress: tx.from,
            toAddress: tx.to,
            amountStroops,
            currency,
            balances: structuredClone(acc.balances),
          });
        } else {
          // swap
          const sourceCurrency = toCurrency(
            tx.source_asset_type,
            tx.source_asset_code,
          );
          const destinationCurrency = toCurrency(tx.asset_type, tx.asset_code);
          const sourceAmountStroops = toStroops(tx.source_amount);
          const destinationAmountStroops = toStroops(tx.amount);
          acc.balances[sourceCurrency] -= sourceAmountStroops;
          acc.balances[destinationCurrency] += destinationAmountStroops;
          acc.transactions.push({
            transactionHash: tx.transaction_hash,
            date: new Date(tx.created_at),
            type: "swap",
            sourceAmountStroops,
            sourceCurrency,
            destinationAmountStroops,
            destinationCurrency,
            balances: structuredClone(acc.balances),
          });
        }
      } else if (tx.type === "invoke_host_function") {
        const balanceChange = tx.asset_balance_changes[0];
        const currency = toCurrency(
          balanceChange.asset_type,
          balanceChange.asset_code,
        );
        const isDeposit = balanceChange.from === walletAddress;
        if (balanceChange.type !== "transfer") {
          throw new Error("Expected balance change to be a transfer");
        }
        if (isDeposit) {
          acc.balances[currency] -= toStroops(balanceChange.amount);
        } else {
          acc.balances[currency] += toStroops(balanceChange.amount);
        }
        acc.transactions.push({
          transactionHash: tx.transaction_hash,
          date: new Date(tx.created_at),
          type: isDeposit ? "blend_deposit" : "blend_withdraw",
          fromAddress: balanceChange.from,
          toAddress: balanceChange.to,
          amountStroops: toStroops(balanceChange.amount),
          currency,
          balances: structuredClone(acc.balances),
        });
      } else {
        throw new Error(`Unknown transaction type: ${tx.type}`);
      }
      return acc;
    },
    {
      transactions: [],
      balances: {
        XLM: 0n,
        USDC: 0n,
        EURC: 0n,
      },
    } as Output,
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
          "XLM Balance": toDecimal(tx.balances.XLM),
          "USDC Balance": toDecimal(tx.balances.USDC),
          "EURC Balance": toDecimal(tx.balances.EURC),
        };
      } else {
        return {
          Date: tx.date.toISOString(),
          Type: tx.type,
          Amount: toDecimal(tx.amountStroops),
          Currency: tx.currency,
          From: tx.fromAddress,
          To: tx.toAddress,
          "XLM Balance": toDecimal(tx.balances.XLM),
          "USDC Balance": toDecimal(tx.balances.USDC),
          "EURC Balance": toDecimal(tx.balances.EURC),
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
        "XLM Balance",
        "USDC Balance",
        "EURC Balance",
      ],
    },
  );
  console.log(outputCsv);
};

if (require.main === module) {
  main();
}
