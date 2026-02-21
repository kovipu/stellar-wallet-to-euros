import type {
  BlendDailyRow,
  BlendPosition,
  BalanceHistoryEntry,
  UserActionEntry,
  ApyHistoryEntry,
} from "./types";

const SUPPLY_ACTIONS = new Set(["supply", "supply_collateral"]);
const WITHDRAW_ACTIONS = new Set(["withdraw", "withdraw_collateral"]);

function toStroops(tokenAmount: number): bigint {
  return BigInt(Math.round(tokenAmount * 1e7));
}

export function calculateDailyYields(
  position: BlendPosition,
  balanceHistory: BalanceHistoryEntry[],
  userActions: UserActionEntry[],
  apyHistory: ApyHistoryEntry[],
): BlendDailyRow[] {
  // Filter and sort balance history for this pool (API returns DESC, we want ASC)
  const poolBalances = balanceHistory
    .filter((b) => b.pool_id === position.poolId)
    .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));

  if (poolBalances.length === 0) return [];

  // Build date -> {deposits, withdrawals} map from user actions
  const actionsByDate = new Map<
    string,
    { deposits: bigint; withdrawals: bigint }
  >();

  for (const action of userActions) {
    if (action.pool_id !== position.poolId) continue;
    if (action.asset_address !== position.assetAddress) continue;
    if (action.amount_underlying == null) continue;

    const dateKey = action.ledger_closed_at.split("T")[0];
    const entry = actionsByDate.get(dateKey) ?? {
      deposits: 0n,
      withdrawals: 0n,
    };
    const amount = BigInt(action.amount_underlying);

    if (SUPPLY_ACTIONS.has(action.action_type)) {
      entry.deposits += amount;
    } else if (WITHDRAW_ACTIONS.has(action.action_type)) {
      entry.withdrawals += amount;
    }
    actionsByDate.set(dateKey, entry);
  }

  // Build APY lookup
  const apyByDate = new Map<string, number>();
  for (const a of apyHistory) {
    apyByDate.set(a.date, a.apy);
  }

  // Walk balance history chronologically
  const rows: BlendDailyRow[] = [];
  let cumulativeYieldStroops = 0n;

  for (let i = 0; i < poolBalances.length; i++) {
    const bal = poolBalances[i];
    const date = bal.snapshot_date;
    const balanceStroops = toStroops(
      bal.supply_balance + bal.collateral_balance,
    );

    const actions = actionsByDate.get(date) ?? {
      deposits: 0n,
      withdrawals: 0n,
    };

    let yieldStroops = 0n;
    if (i > 0) {
      const prevBal = poolBalances[i - 1];
      const prevBalanceStroops = toStroops(
        prevBal.supply_balance + prevBal.collateral_balance,
      );
      yieldStroops =
        balanceStroops -
        prevBalanceStroops -
        actions.deposits +
        actions.withdrawals;
    }

    cumulativeYieldStroops += yieldStroops;

    rows.push({
      date,
      poolId: position.poolId,
      poolName: position.poolName,
      currency: position.currency,
      assetAddress: position.assetAddress,
      balanceStroops,
      depositsStroops: actions.deposits,
      withdrawalsStroops: actions.withdrawals,
      yieldStroops,
      cumulativeYieldStroops,
      apyPercent: apyByDate.get(date) ?? 0,
      // EUR values filled later by applyPrices
      priceEurMicro: 0n,
      balanceEurCents: 0n,
      yieldEurCents: 0n,
      cumulativeYieldEurCents: 0n,
    });
  }

  return rows;
}
