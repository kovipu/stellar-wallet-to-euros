import { Horizon } from "@stellar/stellar-sdk";
type TransactionRecord = Horizon.ServerApi.TransactionRecord;
type OperationRecord = Horizon.ServerApi.OperationRecord;
type TradeRecord = Horizon.ServerApi.TradeRecord;

const horizonServer = new Horizon.Server("https://horizon.stellar.org");

export type TxWithOps = {
  tx: TransactionRecord;
  ops: OperationRecord[];
  trades?: TradeRecord[];
};

// TODO: find a nicer way to get the offerId for a manage_sell_offer tx
const offerIdByTxHash: Record<string, string> = {
  "448e8f032d02fe7d018d5f09761b5bac03bcace1b2c55277d91bd20be160744b":
    "1799912560",
  "9e3acf4434995cbc6728a7e7e9d73b00e42841b8ddbeb787a9412d72dc6c7593":
    "1800705918",
};

/** Fetch all the transactions with operations for the wallet specified */
export async function fetchTransactionsWithOps(
  wallet: string,
): Promise<TxWithOps[]> {
  const txs = await fetchTransactions(wallet);
  const ops = await fetchOperations(wallet);

  // Group operations by transaction hash
  const opsByTxHash = new Map<string, OperationRecord[]>();
  for (const op of ops) {
    const txHash = op.transaction_hash;
    if (!opsByTxHash.has(txHash)) {
      opsByTxHash.set(txHash, []);
    }
    opsByTxHash.get(txHash)!.push(op);
  }

  const txWithOps = txs.map(async (tx) => {
    const ops = opsByTxHash.get(tx.hash) || [];

    const offerId = offerIdByTxHash[tx.hash];
    const trades = offerId ? await fetchTradesForOffer(offerId) : undefined;

    return { tx, ops, trades };
  });

  return Promise.all(txWithOps);
}

/** Fetch all txs for the account (paginated) */
async function fetchTransactions(wallet: string): Promise<TransactionRecord[]> {
  console.log(`Fetching transactions...`);

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
  return txs;
}

/** Fetch all operations for the account (paginated) */
async function fetchOperations(wallet: string): Promise<OperationRecord[]> {
  // 2) Fetch ALL operations for the account at once
  console.log(`Fetching operations...`);

  let page = await horizonServer
    .operations()
    .forAccount(wallet)
    .limit(200)
    .order("asc")
    .call();

  const ops: OperationRecord[] = [];
  while (true) {
    // Filter out dusting attacks' ops to other wallets
    const opsForWallet = page.records.filter((op) => {
      if (op.type === "payment") {
        return op.source_account === wallet || op.to === wallet;
      }
      if (op.type === "create_claimable_balance") {
        return op.claimants.some((c) => c.destination === wallet);
      }
      return true;
    });
    ops.push(...opsForWallet);
    if (page.records.length < 200) break;
    page = await page.next();
  }

  console.log(`Fetched ${ops.length} operations.`);
  return ops;
}

/** Fetch all the trades for a specific offer */
async function fetchTradesForOffer(offerId: string): Promise<TradeRecord[]> {
  console.log(`Fetching trades for offer ${offerId}...`);

  let page = await horizonServer
    .trades()
    .forOffer(offerId)
    .limit(200)
    .order("asc")
    .call();

  const trades: TradeRecord[] = [];
  while (true) {
    trades.push(...page.records);
    if (page.records.length < 200) break;
    page = await page.next();
  }

  console.log(`Fetched ${trades.length} trades for offer ${offerId}.`);
  return trades;
}
