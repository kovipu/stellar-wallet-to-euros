import { Horizon } from "@stellar/stellar-sdk";

const horizonServer = new Horizon.Server("https://horizon.stellar.org");

export type TxWithOps = {
  tx: Horizon.ServerApi.TransactionRecord;
  ops: Horizon.ServerApi.OperationRecord[];
};

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

  // 2) For each tx, fetch its operations (paginated just in case)
  console.log(`Fetching operations...`);
  const result: TxWithOps[] = [];
  for (const tx of txs) {
    let opPage = await horizonServer
      .operations()
      .forTransaction(tx.hash)
      .limit(200)
      .order("asc")
      .call();
    const ops: Horizon.ServerApi.OperationRecord[] = [];
    while (true) {
      // this bullshit is to filter out dusting attacks' ops to other wallets
      const opsForWallet = opPage.records.filter((op) => {
        if (op.type === "payment") {
          return op.source_account === wallet || op.to === wallet;
        }
        if (op.type === "create_claimable_balance") {
          return op.claimants.some((c) => c.destination === wallet);
        }
        return true;
      });
      ops.push(...opsForWallet);
      if (opPage.records.length < 200) break;
      opPage = await opPage.next();
    }
    result.push({ tx, ops });
  }
  console.log(`Fetched all operations.`);

  return result;
}
