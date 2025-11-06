import { Horizon } from "@stellar/stellar-sdk";

const horizonServer = new Horizon.Server("https://horizon.stellar.org");

export type TxWithOps = {
  tx: Horizon.ServerApi.TransactionRecord;
  ops: Horizon.ServerApi.OperationRecord[];
};

/** Fetch all the transactions with operations for the wallet specified */
export async function fetchTransactionsWithOps(
  wallet: string,
): Promise<TxWithOps[]> {
  console.log(`Fetching transactions...`);

  // 1) Fetch ALL txs for the account (paginated)
  let page = await horizonServer
    .transactions()
    .forAccount(wallet)
    .limit(200)
    .order("asc")
    .call();
  const txs: Horizon.ServerApi.TransactionRecord[] = [];
  while (true) {
    txs.push(...page.records);
    if (page.records.length < 200) break;
    page = await page.next();
  }
  console.log(`Fetched ${txs.length} transactions.`);

  // 2) Fetch ALL operations for the account at once
  console.log(`Fetching operations...`);
  let opPage = await horizonServer
    .operations()
    .forAccount(wallet)
    .limit(200)
    .order("asc")
    .call();
  const allOps: Horizon.ServerApi.OperationRecord[] = [];
  while (true) {
    // Filter out dusting attacks' ops to other wallets
    const opsForWallet = opPage.records.filter((op) => {
      if (op.type === "payment") {
        return op.source_account === wallet || op.to === wallet;
      }
      if (op.type === "create_claimable_balance") {
        return op.claimants.some((c) => c.destination === wallet);
      }
      return true;
    });
    allOps.push(...opsForWallet);
    if (opPage.records.length < 200) break;
    opPage = await opPage.next();
  }
  console.log(`Fetched ${allOps.length} operations.`);

  // 3) Group operations by transaction hash
  const opsByTxHash = new Map<string, Horizon.ServerApi.OperationRecord[]>();
  for (const op of allOps) {
    const txHash = op.transaction_hash;
    if (!opsByTxHash.has(txHash)) {
      opsByTxHash.set(txHash, []);
    }
    opsByTxHash.get(txHash)!.push(op);
  }

  // 4) Build TxWithOps array
  const result: TxWithOps[] = txs.map((tx) => ({
    tx,
    ops: opsByTxHash.get(tx.hash) || [],
  }));

  return result;
}
