export interface BlendDailyRow {
  date: string; // YYYY-MM-DD
  poolId: string;
  poolName: string;
  currency: Currency;
  assetAddress: string;
  balanceStroops: bigint; // supply + collateral in underlying tokens
  depositsStroops: bigint; // deposits on this day
  withdrawalsStroops: bigint; // withdrawals on this day
  yieldStroops: bigint; // balance - prevBalance - deposits + withdrawals
  cumulativeYieldStroops: bigint;
  apyPercent: number;
  priceEurMicro: bigint; // micro-EUR per token
  balanceEurCents: bigint;
  yieldEurCents: bigint;
  cumulativeYieldEurCents: bigint;
}

export interface BlendPosition {
  poolId: string;
  poolName: string;
  assetAddress: string;
  currency: Currency; // mapped from asset_symbol
}

// Smoothie API response types

export interface BalanceHistoryEntry {
  pool_id: string;
  snapshot_date: string;
  supply_balance: number;
  collateral_balance: number;
  debt_balance: number;
  net_balance: number;
  b_rate: number;
  total_cost_basis: number;
}

export interface ApyHistoryEntry {
  date: string;
  apy: number;
}

export interface UserActionEntry {
  pool_id: string;
  pool_name: string;
  action_type: string;
  asset_address: string;
  asset_symbol: string;
  amount_underlying: string | null; // stroops as string (bigint from DB)
  ledger_closed_at: string;
}

interface BalanceHistoryResponse {
  user_address: string;
  asset_address: string;
  days: number;
  count: number;
  history: BalanceHistoryEntry[];
  firstEventDate: string | null;
  source: string;
}

interface ApyHistoryResponse {
  pool_id: string;
  asset_address: string;
  days: number;
  count: number;
  history: ApyHistoryEntry[];
}

interface UserActionsResponse {
  user_address: string;
  count: number;
  limit: number;
  offset: number;
  actions: UserActionEntry[];
}
