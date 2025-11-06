import { MICRO_PER_EUR, valueCentsFromStroops } from "../domain/units";
import { dateKeyUTC } from "../pricing/date-keys";
import { PriceBook } from "../pricing/price-service";

// What created a lot
export type AcqKind =
  | "create_account"
  | "payment_in"
  | "swap_in"
  | "blend_withdraw"
  | "eurc_par";

// What disposed a lot slice
export type DispKind =
  | "payment_out"
  | "swap_out"
  | "blend_deposit"
  | "swap_fee"
  | "network_fee";

export type Batch = {
  batchId: string; // e.g., "XLM#0001"
  currency: Currency;
  acquiredAt: Date; // tx date
  acqKind: AcqKind;
  acqTxHash: string;
  priceMicroAtAcq: bigint; // micro-EUR per 1 unit (asset) at acquisition
  qtyInitialStroops: bigint; // initial size
  qtyRemainingStroops: bigint; // remaining size
};

export type Fill = {
  txHash: string;
  currency: Currency;
  amountStroops: bigint; // amount taken from the batch
  acquiredAt: Date;
  disposedAt: Date;
  dispKind: DispKind;
  batchId: string;
  proceedsCents: bigint; // valued at disposal day price of disposed asset (except fees: 0)
  costCents: bigint; // valued at acquisition price of that batch
  gainLossCents: bigint; // proceeds - cost
  acqPriceMicro: bigint;
  dispPriceMicro: bigint;
};

export type FifoResult = {
  fills: Fill[];
  endingBatches: Record<Currency, Batch[]>;
};

export function computeFifoFills(
  txRows: readonly TxRow[],
  priceBook: PriceBook,
): FifoResult {
  const inventories: Record<Currency, Batch[]> = {
    XLM: [],
    USDC: [],
    // handle EURC as a single rolling batch, because proceeds = cost
    EURC: [
      {
        batchId: "EURC#PAR",
        currency: "EURC",
        acquiredAt: new Date(0), // epoch placeholder
        acqKind: "eurc_par",
        acqTxHash: "PAR",
        priceMicroAtAcq: MICRO_PER_EUR,
        qtyInitialStroops: 0n,
        qtyRemainingStroops: 0n,
      },
    ],
  };

  // Sequence counters for batch IDs
  const batchSeq = { XLM: 0, USDC: 0 };

  const fills: Fill[] = [];

  // --- helpers ---

  const getPriceMicro = (currency: Currency, date: Date): bigint => {
    if (currency === "EURC") return MICRO_PER_EUR;
    const key = `${currency}:${dateKeyUTC(date)}`;
    const micro = priceBook[key]?.priceMicroEur;
    if (micro === undefined) {
      throw new Error(`Missing price for ${key}`);
    }
    return micro;
  };

  // implied micro-EUR per 1 source unit from the destination leg
  const impliedPerSourceMicro = (
    destAmountStroops: bigint,
    destPriceMicro: bigint,
    srcAmountStroops: bigint,
  ): bigint =>
    (destAmountStroops * destPriceMicro + srcAmountStroops / 2n) /
    srcAmountStroops;

  const newBatchId = (currency: Exclude<Currency, "EURC">) =>
    `${currency}#${String(++batchSeq[currency]).padStart(4, "0")}`;

  const addBatch = (
    currency: Currency,
    qty: bigint,
    date: Date,
    txHash: string,
    acqKind: AcqKind,
  ) => {
    if (qty === 0n) return;
    if (currency === "EURC") {
      // Collapse EURC into a single par lot
      const lot = inventories.EURC[0];
      lot.qtyRemainingStroops += qty;
      lot.qtyInitialStroops += qty; // optional tally of total inflow
      return;
    }
    // XLM / USDC: normal FIFO lot
    inventories[currency].push({
      batchId: newBatchId(currency),
      currency,
      acquiredAt: date,
      acqKind,
      acqTxHash: txHash,
      priceMicroAtAcq: getPriceMicro(currency, date),
      qtyInitialStroops: qty,
      qtyRemainingStroops: qty,
    });
  };

  const dispose = (params: {
    currency: Currency;
    amountStroops: bigint;
    date: Date;
    txHash: string;
    dispKind: DispKind;
    proceedsPriceMicro?: bigint; // set to 0n for fees
  }) => {
    let remaining = params.amountStroops;
    if (remaining === 0n) return;

    if (params.currency === "EURC") {
      // Consume from single par lot
      const lot = inventories.EURC[0];
      if (lot.qtyRemainingStroops < remaining) {
        throw new Error(
          `EURC underflow on ${params.date.toISOString()} (need ${remaining}, have ${lot.qtyRemainingStroops})`,
        );
      }
      const dispPrice = params.proceedsPriceMicro ?? MICRO_PER_EUR;
      const proceedsCents = valueCentsFromStroops(remaining, dispPrice);
      const costCents = valueCentsFromStroops(remaining, MICRO_PER_EUR);
      const fill: Fill = {
        txHash: params.txHash,
        currency: "EURC",
        amountStroops: remaining,
        batchId: lot.batchId,
        acquiredAt: lot.acquiredAt,
        disposedAt: params.date,
        dispKind: params.dispKind,
        acqPriceMicro: MICRO_PER_EUR,
        dispPriceMicro: dispPrice,
        proceedsCents,
        costCents,
        gainLossCents: proceedsCents - costCents, // 0 for normal disposals; negative for fees
      };
      fills.push(fill);
      lot.qtyRemainingStroops -= remaining;
      return;
    }

    // XLM / USDC disposals: consume FIFO across multiple lots if needed
    const disposalPrice =
      params.proceedsPriceMicro ?? getPriceMicro(params.currency, params.date);
    const inv = inventories[params.currency];

    while (remaining > 0n) {
      const lot = inv.find((b) => b.qtyRemainingStroops > 0n);
      if (!lot) {
        throw new Error(
          `FIFO underflow for ${params.currency} on ${params.date.toISOString()} (need ${remaining})`,
        );
      }
      const slice =
        remaining <= lot.qtyRemainingStroops
          ? remaining
          : lot.qtyRemainingStroops;

      const proceedsCents = valueCentsFromStroops(slice, disposalPrice);
      const costCents = valueCentsFromStroops(slice, lot.priceMicroAtAcq);

      fills.push({
        txHash: params.txHash,
        currency: params.currency,
        amountStroops: slice,
        batchId: lot.batchId,
        acquiredAt: lot.acquiredAt,
        disposedAt: params.date,
        dispKind: params.dispKind,
        acqPriceMicro: lot.priceMicroAtAcq,
        dispPriceMicro: disposalPrice,
        proceedsCents,
        costCents,
        gainLossCents: proceedsCents - costCents,
      });

      lot.qtyRemainingStroops -= slice;
      remaining -= slice;
    }
  };

  // ---- main loop ----
  for (const tx of txRows) {
    for (const op of tx.ops) {
      if (op.kind === "create_account") {
        addBatch(
          "XLM",
          op.amountStroops,
          tx.date,
          tx.transactionHash,
          "create_account",
        );
      } else if (op.kind === "payment" && op.direction === "in") {
        addBatch(
          op.currency,
          op.amountStroops,
          tx.date,
          tx.transactionHash,
          "payment_in",
        );
      } else if (op.kind === "payment" && op.direction === "out") {
        dispose({
          currency: op.currency,
          amountStroops: op.amountStroops,
          date: tx.date,
          txHash: tx.transactionHash,
          dispKind: "payment_out",
        });
      } else if (op.kind === "swap") {
        // anchor proceeds on destination leg
        const destMicro = getPriceMicro(op.destinationCurrency, tx.date);
        const perSourceMicro = impliedPerSourceMicro(
          op.destinationAmountStroops,
          destMicro,
          op.sourceAmountStroops,
        );

        // source = disposal with implied proceeds per unit
        dispose({
          currency: op.sourceCurrency,
          amountStroops: op.sourceAmountStroops,
          date: tx.date,
          txHash: tx.transactionHash,
          dispKind: "swap_out",
          proceedsPriceMicro: perSourceMicro,
        });

        // destination = acquisition (its acq price is its own market price)
        addBatch(
          op.destinationCurrency,
          op.destinationAmountStroops,
          tx.date,
          tx.transactionHash,
          "swap_in",
        );
      } else if (op.kind == "blend_deposit") {
        // treat deposit as disposal
        dispose({
          currency: op.currency,
          amountStroops: op.amountStroops,
          date: tx.date,
          txHash: tx.transactionHash,
          dispKind: "blend_deposit",
        });
      } else if (op.kind === "blend_withdraw") {
        // treat withdraw as acquisition
        addBatch(
          op.currency,
          op.amountStroops,
          tx.date,
          tx.transactionHash,
          "blend_withdraw",
        );
      } else if (op.kind === "swap_fee") {
        // Disposal with zero proceeds
        dispose({
          currency: op.currency,
          amountStroops: op.amountStroops,
          date: tx.date,
          txHash: tx.transactionHash,
          dispKind: "swap_fee",
          proceedsPriceMicro: 0n,
        });
      }
    }

    // Network fee in XLM: disposal with zero proceeds
    if (tx.feeStroops && tx.feeStroops > 0n) {
      dispose({
        currency: "XLM",
        amountStroops: tx.feeStroops,
        date: tx.date,
        txHash: tx.transactionHash,
        dispKind: "network_fee",
        proceedsPriceMicro: 0n,
      });
    }
  }

  return { fills, endingBatches: inventories };
}
