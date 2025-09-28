type Currency = "XLM" | "USDC" | "EURC";

type Balances = {
  XLM: bigint;
  USDC: bigint;
  EURC: bigint;
};

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
