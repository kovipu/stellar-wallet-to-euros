import { toCurrency, toStroops } from "../domain/units";
import { TxWithOps } from "./horizon";

/** Process all transactions and calculate the running balance */
export function processTransactions(
  transactions: TxWithOps[],
  walletAddress: string,
): TxRow[] {
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
