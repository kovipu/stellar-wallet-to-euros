import { stringify } from "csv-stringify/sync";
import { fetchTransactionsWithOps, TxWithOps } from "./stellar-network";

// Get transactions and calculate their taxes with first in first out
async function main() {
  const walletAddress = process.argv[2];

  if (!walletAddress) {
    console.error("Usage: tsx script.py.ts <stellar-wallet-address>");
    process.exit(1);
  }

  try {
    console.log(`Fetching transactions for wallet: ${walletAddress}`);

    const allTransactions: TxWithOps[] =
      await fetchTransactionsWithOps(walletAddress);

    const txRows = await processTransactions(allTransactions, walletAddress);
    exportToCsv(txRows);
  } catch (error) {
    console.error("Error:", (error as Error).message);
  }
}

type Currency = "XLM" | "USDC" | "EURC";

type Balances = Record<Currency, bigint>;

type TxRow = {
  transactionHash: string;
  date: Date;
  feeStroops: bigint; // applied once per tx (0 if not your fee)
  ops: TxOpSummary[]; // human-friendly summary of what changed
  balances: Balances; // snapshot after this tx
};

type TxOpSummary =
  | { kind: "create_account"; from: string; to: string; amountStroops: bigint }
  | {
      kind: "payment";
      direction: "in" | "out";
      from: string;
      to: string;
      currency: Currency;
      amountStroops: bigint;
    }
  | {
      kind: "swap";
      sourceCurrency: Currency;
      sourceAmountStroops: bigint;
      destinationCurrency: Currency;
      destinationAmountStroops: bigint;
    }
  | {
      kind: "blend_deposit" | "blend_withdraw";
      from: string;
      to: string;
      currency: Currency;
      amountStroops: bigint;
    }
  | {
      kind: "change_trust";
      currency: Currency;
    }
  | {
      kind: "set_options";
    }
  | {
      kind: "create_claimable_balance";
      amount: string;
      currency: string;
    };

export async function processTransactions(
  transactions: TxWithOps[],
  walletAddress: string,
): Promise<TxRow[]> {
  const txRows: TxRow[] = [];
  const balances: Balances = {
    XLM: 0n,
    USDC: 0n,
    EURC: 0n,
  };

  for (const { tx, ops } of transactions) {
    const rowOps: TxOpSummary[] = [];

    // Apply operation effects
    for (const op of ops) {
      if (op.type === "create_account") {
        const amountStroops = toStroops(op.starting_balance);
        rowOps.push({
          kind: "create_account",
          from: op.funder,
          to: walletAddress,
          amountStroops,
        });
        balances.XLM = amountStroops;
      } else if (op.type === "payment") {
        const currency = toCurrency(op.asset_type, op.asset_code);
        if (op.to === walletAddress) {
          rowOps.push({
            kind: "payment",
            direction: "in",
            from: op.from,
            to: op.to,
            currency,
            amountStroops: toStroops(op.amount),
          });
          balances[currency] += toStroops(op.amount);
        } else {
          rowOps.push({
            kind: "payment",
            direction: "out",
            from: op.from,
            to: op.to,
            currency,
            amountStroops: toStroops(op.amount),
          });
          balances[currency] -= toStroops(op.amount);
        }
      } else if (
        op.type === "path_payment_strict_send" ||
        op.type === "path_payment_strict_receive"
      ) {
        const sourceCurrency = toCurrency(
          op.source_asset_type,
          op.source_asset_code,
        );
        const sourceAmountStroops = toStroops(op.source_amount);

        if (op.to === walletAddress) {
          // treat as swap: source debited, destination credited
          const destinationCurrency = toCurrency(op.asset_type, op.asset_code);
          const destinationAmountStroops = toStroops(op.amount);
          rowOps.push({
            kind: "swap",
            sourceCurrency,
            sourceAmountStroops,
            destinationCurrency,
            destinationAmountStroops,
          });
          balances[sourceCurrency] -= sourceAmountStroops;
          balances[destinationCurrency] += destinationAmountStroops;
        } else {
          // outbound payment via path
          rowOps.push({
            kind: "payment",
            direction: "out",
            from: op.from,
            to: op.to,
            currency: sourceCurrency,
            amountStroops: sourceAmountStroops,
          });
          balances[sourceCurrency] -= sourceAmountStroops;
        }
      } else if (op.type === "invoke_host_function") {
        const balanceChange = op.asset_balance_changes[0];
        if (balanceChange.type !== "transfer") {
          throw new Error("Expected balance change to be a transfer");
        }

        const currency = toCurrency(
          balanceChange.asset_type,
          balanceChange.asset_code,
        );

        if (balanceChange.from === walletAddress) {
          // deposit
          rowOps.push({
            kind: "blend_deposit",
            from: balanceChange.from,
            to: balanceChange.to,
            currency,
            amountStroops: toStroops(balanceChange.amount),
          });
          balances[currency] -= toStroops(balanceChange.amount);
        } else {
          // withdraw
          rowOps.push({
            kind: "blend_withdraw",
            from: balanceChange.from,
            to: balanceChange.to,
            currency,
            amountStroops: toStroops(balanceChange.amount),
          });
          balances[currency] += toStroops(balanceChange.amount);
        }
      } else if (op.type === "change_trust") {
        rowOps.push({
          kind: "change_trust",
          currency: toCurrency(op.asset_type, op.asset_code),
        });
      } else if (op.type === "set_options") {
        rowOps.push({
          kind: "set_options",
        });
      } else if (op.type === "create_claimable_balance") {
        rowOps.push({
          kind: "create_claimable_balance",
          amount: op.amount,
          currency: op.asset,
        });
      } else {
        throw new Error(`Unknown operation type: ${op.type}`);
      }
    }

    // Apply TX fee once, only if we are the fee payer
    const fee = tx.fee_account === walletAddress ? BigInt(tx.fee_charged) : 0n;
    if (fee > 0n) balances.XLM -= fee;

    // Snapshot transaction and balances
    txRows.push({
      transactionHash: tx.hash,
      date: new Date(tx.created_at),
      feeStroops: fee,
      ops: rowOps,
      balances: structuredClone(balances),
    });
  }
  return txRows;
}

// Convert amount to BigInt stroops.
const toStroops = (amount: string): bigint => {
  // Remove commas first
  const cleanAmount = amount.replace(",", "");

  // Split by decimal point
  const parts = cleanAmount.split(".");

  if (parts.length === 1) {
    // No decimal point - this is already in stroops (like fees from API)
    return BigInt(parts[0]);
  } else if (parts.length === 2) {
    // Has decimal point - convert from XLM to stroops
    const integerPart = parts[0];
    const decimalPart = parts[1].padEnd(7, "0").slice(0, 7); // Pad to 7 digits and truncate if longer

    return BigInt(integerPart) * 10000000n + BigInt(decimalPart);
  } else {
    throw new Error(`Invalid amount format: ${amount}`);
  }
};

const toDecimal = (amount: bigint): string => {
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

const exportToCsv = (output: TxRow[]) => {
  const outputCsv = stringify(
    output.map((tx) => {
      return {
        Date: tx.date.toISOString(),
        Type: tx.ops.map((op) => op.kind).join(", "),
        Fee: toDecimal(tx.feeStroops),
        "XLM Balance": toDecimal(tx.balances.XLM),
        "USDC Balance": toDecimal(tx.balances.USDC),
        "EURC Balance": toDecimal(tx.balances.EURC),
        "Transaction Explorer": `https://stellar.expert/explorer/public/tx/${tx.transactionHash}`,
      };
    }),
    {
      header: true,
      columns: [
        "Date",
        "Type",
        "Fee",
        "XLM Balance",
        "USDC Balance",
        "EURC Balance",
        "Transaction Explorer",
      ],
    },
  );
  console.log(outputCsv);
};

if (require.main === module) {
  main();
}
