import { describe, it, expect } from "vitest";
import { computeFifoFills } from "./fifo";
import { PriceBook } from "../pricing/price-service";
import { MICRO_PER_EUR } from "../domain/units";

// Helper to create a minimal TxRow
const createTx = (
  date: Date,
  ops: TxOpSummary[],
  feeStroops: bigint = 0n,
  transactionHash: string = "tx_hash",
): TxRow => ({
  transactionHash,
  date,
  feeStroops,
  ops,
  balances: { XLM: 0n, USDC: 0n, EURC: 0n },
});

// Helper to create mock price book
const createPriceBook = (prices: Record<string, number>): PriceBook => {
  const book: PriceBook = {};
  for (const [key, eurPrice] of Object.entries(prices)) {
    book[key] = {
      priceMicroEur: BigInt(Math.round(eurPrice * 1_000_000)),
      dateKey: key.split(":")[1],
      source: "coingecko",
      fetchedAt: Date.now(),
    };
  }
  return book;
};

describe("fifo.ts", () => {
  describe("Batch Creation Tests", () => {
    it("should create XLM batch from create_account", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 10_0000000n, // 10 XLM
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.5, // 0.5 EUR per XLM
      });

      const result = computeFifoFills(txs, priceBook);

      expect(result.endingBatches.XLM).toHaveLength(1);
      const batch = result.endingBatches.XLM[0];
      expect(batch.batchId).toBe("XLM#0001");
      expect(batch.currency).toBe("XLM");
      expect(batch.acqKind).toBe("create_account");
      expect(batch.qtyInitialStroops).toBe(10_0000000n);
      expect(batch.qtyRemainingStroops).toBe(10_0000000n);
      expect(batch.priceMicroAtAcq).toBe(500_000n); // 0.5 EUR in micro-EUR
    });

    it("should create batches from payment_in for each currency", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "XLM",
            amountStroops: 5_0000000n,
          },
        ]),
        createTx(new Date("2025-01-02"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "USDC",
            amountStroops: 100_0000000n,
          },
        ]),
        createTx(new Date("2025-01-03"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "EURC",
            amountStroops: 50_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.5,
        "USDC:2025-01-02": 0.95,
      });

      const result = computeFifoFills(txs, priceBook);

      expect(result.endingBatches.XLM).toHaveLength(1);
      expect(result.endingBatches.XLM[0].batchId).toBe("XLM#0001");
      expect(result.endingBatches.XLM[0].qtyRemainingStroops).toBe(5_0000000n);

      expect(result.endingBatches.USDC).toHaveLength(1);
      expect(result.endingBatches.USDC[0].batchId).toBe("USDC#0001");
      expect(result.endingBatches.USDC[0].qtyRemainingStroops).toBe(
        100_0000000n,
      );

      // EURC has single par batch
      expect(result.endingBatches.EURC).toHaveLength(1);
      expect(result.endingBatches.EURC[0].batchId).toBe("EURC#PAR");
      expect(result.endingBatches.EURC[0].qtyRemainingStroops).toBe(
        50_0000000n,
      );
    });

    it("should create batch from swap_in", () => {
      const txs = [
        // First acquire some XLM
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 100_0000000n,
          },
        ]),
        // Then swap XLM -> USDC
        createTx(new Date("2025-01-02"), [
          {
            kind: "swap",
            sourceCurrency: "XLM",
            sourceAmountStroops: 50_0000000n,
            destinationCurrency: "USDC",
            destinationAmountStroops: 20_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.4,
        "XLM:2025-01-02": 0.5,
        "USDC:2025-01-02": 0.95,
      });

      const result = computeFifoFills(txs, priceBook);

      // Should have USDC batch from swap_in
      expect(result.endingBatches.USDC).toHaveLength(1);
      expect(result.endingBatches.USDC[0].batchId).toBe("USDC#0001");
      expect(result.endingBatches.USDC[0].acqKind).toBe("swap_in");
      expect(result.endingBatches.USDC[0].qtyRemainingStroops).toBe(
        20_0000000n,
      );
      expect(result.endingBatches.USDC[0].priceMicroAtAcq).toBe(950_000n);
    });

    it("should create batch from blend_withdraw", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "blend_withdraw",
            from: "pool",
            to: "wallet",
            currency: "USDC",
            amountStroops: 100_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "USDC:2025-01-01": 0.92,
      });

      const result = computeFifoFills(txs, priceBook);

      expect(result.endingBatches.USDC).toHaveLength(1);
      expect(result.endingBatches.USDC[0].acqKind).toBe("blend_withdraw");
      expect(result.endingBatches.USDC[0].qtyRemainingStroops).toBe(
        100_0000000n,
      );
    });

    it("should ignore zero-amount acquisitions", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "XLM",
            amountStroops: 0n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.5,
      });

      const result = computeFifoFills(txs, priceBook);

      expect(result.endingBatches.XLM).toHaveLength(0);
    });

    it("should increment single EURC par batch, not create new ones", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "EURC",
            amountStroops: 50_0000000n,
          },
        ]),
        createTx(new Date("2025-01-02"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "EURC",
            amountStroops: 30_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({});

      const result = computeFifoFills(txs, priceBook);

      // Should still have only one EURC batch
      expect(result.endingBatches.EURC).toHaveLength(1);
      expect(result.endingBatches.EURC[0].batchId).toBe("EURC#PAR");
      expect(result.endingBatches.EURC[0].qtyRemainingStroops).toBe(
        80_0000000n,
      );
      expect(result.endingBatches.EURC[0].qtyInitialStroops).toBe(80_0000000n);
      expect(result.endingBatches.EURC[0].priceMicroAtAcq).toBe(MICRO_PER_EUR);
    });

    it("should sequence batch IDs correctly", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 10_0000000n,
          },
        ]),
        createTx(new Date("2025-01-02"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "XLM",
            amountStroops: 5_0000000n,
          },
        ]),
        createTx(new Date("2025-01-03"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "USDC",
            amountStroops: 100_0000000n,
          },
        ]),
        createTx(new Date("2025-01-04"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "XLM",
            amountStroops: 3_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.5,
        "XLM:2025-01-02": 0.5,
        "USDC:2025-01-03": 0.95,
        "XLM:2025-01-04": 0.5,
      });

      const result = computeFifoFills(txs, priceBook);

      expect(result.endingBatches.XLM).toHaveLength(3);
      expect(result.endingBatches.XLM[0].batchId).toBe("XLM#0001");
      expect(result.endingBatches.XLM[1].batchId).toBe("XLM#0002");
      expect(result.endingBatches.XLM[2].batchId).toBe("XLM#0003");

      expect(result.endingBatches.USDC).toHaveLength(1);
      expect(result.endingBatches.USDC[0].batchId).toBe("USDC#0001");
    });
  });

  describe("Disposal tests", () => {
    it("should create fill from payment_out disposal", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 100_0000000n,
          },
        ]),
        createTx(new Date("2025-01-05"), [
          {
            kind: "payment",
            direction: "out",
            from: "wallet",
            to: "recipient",
            currency: "XLM",
            amountStroops: 30_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.4,
        "XLM:2025-01-05": 0.6,
      });

      const result = computeFifoFills(txs, priceBook);

      expect(result.fills).toHaveLength(1);
      const fill = result.fills[0];
      expect(fill.currency).toBe("XLM");
      expect(fill.amountStroops).toBe(30_0000000n);
      expect(fill.batchId).toBe("XLM#0001");
      expect(fill.dispKind).toBe("payment_out");
      expect(fill.acqPriceMicro).toBe(400_000n);
      expect(fill.dispPriceMicro).toBe(600_000n);

      // Remaining batch
      expect(result.endingBatches.XLM[0].qtyRemainingStroops).toBe(
        70_0000000n,
      );
    });

    it("should handle partial disposal leaving remaining quantity", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 100_0000000n,
          },
        ]),
        createTx(new Date("2025-01-05"), [
          {
            kind: "payment",
            direction: "out",
            from: "wallet",
            to: "recipient",
            currency: "XLM",
            amountStroops: 25_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.5,
        "XLM:2025-01-05": 0.5,
      });

      const result = computeFifoFills(txs, priceBook);

      const batch = result.endingBatches.XLM[0];
      expect(batch.qtyInitialStroops).toBe(100_0000000n);
      expect(batch.qtyRemainingStroops).toBe(75_0000000n);
    });

    it("should handle complete disposal depleting batch to 0", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 50_0000000n,
          },
        ]),
        createTx(new Date("2025-01-05"), [
          {
            kind: "payment",
            direction: "out",
            from: "wallet",
            to: "recipient",
            currency: "XLM",
            amountStroops: 50_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.5,
        "XLM:2025-01-05": 0.6,
      });

      const result = computeFifoFills(txs, priceBook);

      expect(result.fills).toHaveLength(1);
      expect(result.fills[0].amountStroops).toBe(50_0000000n);
      expect(result.endingBatches.XLM[0].qtyRemainingStroops).toBe(0n);
    });

    it("should handle blend_deposit disposal", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "USDC",
            amountStroops: 200_0000000n,
          },
        ]),
        createTx(new Date("2025-01-05"), [
          {
            kind: "blend_deposit",
            from: "wallet",
            to: "pool",
            currency: "USDC",
            amountStroops: 100_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "USDC:2025-01-01": 0.92,
        "USDC:2025-01-05": 0.95,
      });

      const result = computeFifoFills(txs, priceBook);

      expect(result.fills).toHaveLength(1);
      expect(result.fills[0].dispKind).toBe("blend_deposit");
      expect(result.fills[0].amountStroops).toBe(100_0000000n);
      expect(result.endingBatches.USDC[0].qtyRemainingStroops).toBe(
        100_0000000n,
      );
    });

    it("should handle swap_out disposal with implied price", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 100_0000000n,
          },
        ]),
        createTx(new Date("2025-01-05"), [
          {
            kind: "swap",
            sourceCurrency: "XLM",
            sourceAmountStroops: 50_0000000n,
            destinationCurrency: "USDC",
            destinationAmountStroops: 25_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.4,
        "USDC:2025-01-05": 1.0,
      });

      const result = computeFifoFills(txs, priceBook);

      expect(result.fills).toHaveLength(1);
      const fill = result.fills[0];
      expect(fill.dispKind).toBe("swap_out");
      expect(fill.currency).toBe("XLM");
      expect(fill.amountStroops).toBe(50_0000000n);
      // Implied price from destination: 25 USDC @ 1.0 EUR / 50 XLM = 0.5 EUR per XLM
      expect(fill.dispPriceMicro).toBe(500_000n);
    });

    it("should handle swap_fee disposal with 0 proceeds", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "USDC",
            amountStroops: 100_0000000n,
          },
        ]),
        createTx(new Date("2025-01-05"), [
          {
            kind: "swap_fee",
            from: "wallet",
            to: "recipient",
            currency: "USDC",
            amountStroops: 5_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "USDC:2025-01-01": 0.95,
      });

      const result = computeFifoFills(txs, priceBook);

      expect(result.fills).toHaveLength(1);
      const fill = result.fills[0];
      expect(fill.dispKind).toBe("swap_fee");
      expect(fill.dispPriceMicro).toBe(0n);
      expect(fill.proceedsCents).toBe(0n);
      expect(fill.gainLossCents).toBeLessThan(0n); // Pure loss
    });

    it("should handle network_fee disposal with 0 proceeds", () => {
      const txs = [
        createTx(
          new Date("2025-01-01"),
          [
            {
              kind: "create_account",
              from: "funder",
              to: "wallet",
              amountStroops: 100_0000000n,
            },
          ],
          1000000n, // 0.1 XLM fee
        ),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.5,
      });

      const result = computeFifoFills(txs, priceBook);

      expect(result.fills).toHaveLength(1);
      const fill = result.fills[0];
      expect(fill.dispKind).toBe("network_fee");
      expect(fill.currency).toBe("XLM");
      expect(fill.amountStroops).toBe(1000000n);
      expect(fill.dispPriceMicro).toBe(0n);
      expect(fill.proceedsCents).toBe(0n);
      expect(fill.gainLossCents).toBeLessThan(0n);
    });
  });

  describe("FIFO Ordering Tests", () => {
    it("should consume from oldest batch first", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 50_0000000n,
          },
        ]),
        createTx(new Date("2025-01-02"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "XLM",
            amountStroops: 50_0000000n,
          },
        ]),
        createTx(new Date("2025-01-03"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "XLM",
            amountStroops: 50_0000000n,
          },
        ]),
        createTx(new Date("2025-01-10"), [
          {
            kind: "payment",
            direction: "out",
            from: "wallet",
            to: "recipient",
            currency: "XLM",
            amountStroops: 30_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.4,
        "XLM:2025-01-02": 0.5,
        "XLM:2025-01-03": 0.6,
        "XLM:2025-01-10": 0.7,
      });

      const result = computeFifoFills(txs, priceBook);

      // Should consume from first batch (oldest)
      expect(result.fills).toHaveLength(1);
      expect(result.fills[0].batchId).toBe("XLM#0001");
      expect(result.fills[0].acqPriceMicro).toBe(400_000n); // First batch price

      // First batch partially consumed
      expect(result.endingBatches.XLM[0].qtyRemainingStroops).toBe(
        20_0000000n,
      );
      // Other batches untouched
      expect(result.endingBatches.XLM[1].qtyRemainingStroops).toBe(
        50_0000000n,
      );
      expect(result.endingBatches.XLM[2].qtyRemainingStroops).toBe(
        50_0000000n,
      );
    });

    it("should span multiple batches when disposal exceeds first batch", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 30_0000000n,
          },
        ]),
        createTx(new Date("2025-01-02"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "XLM",
            amountStroops: 40_0000000n,
          },
        ]),
        createTx(new Date("2025-01-03"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "XLM",
            amountStroops: 50_0000000n,
          },
        ]),
        createTx(new Date("2025-01-10"), [
          {
            kind: "payment",
            direction: "out",
            from: "wallet",
            to: "recipient",
            currency: "XLM",
            amountStroops: 60_0000000n, // Spans first two batches
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.4,
        "XLM:2025-01-02": 0.5,
        "XLM:2025-01-03": 0.6,
        "XLM:2025-01-10": 0.7,
      });

      const result = computeFifoFills(txs, priceBook);

      // Should create 2 fills
      expect(result.fills).toHaveLength(2);

      // First fill: entire first batch
      expect(result.fills[0].batchId).toBe("XLM#0001");
      expect(result.fills[0].amountStroops).toBe(30_0000000n);
      expect(result.fills[0].acqPriceMicro).toBe(400_000n);

      // Second fill: partial second batch
      expect(result.fills[1].batchId).toBe("XLM#0002");
      expect(result.fills[1].amountStroops).toBe(30_0000000n);
      expect(result.fills[1].acqPriceMicro).toBe(500_000n);

      // Check remaining quantities
      expect(result.endingBatches.XLM[0].qtyRemainingStroops).toBe(0n);
      expect(result.endingBatches.XLM[1].qtyRemainingStroops).toBe(
        10_0000000n,
      );
      expect(result.endingBatches.XLM[2].qtyRemainingStroops).toBe(
        50_0000000n,
      );
    });

    it("should fully deplete middle batch before moving to next", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 10_0000000n,
          },
        ]),
        createTx(new Date("2025-01-02"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "XLM",
            amountStroops: 20_0000000n,
          },
        ]),
        createTx(new Date("2025-01-03"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "XLM",
            amountStroops: 30_0000000n,
          },
        ]),
        // First disposal: deplete batch 1 and 2
        createTx(new Date("2025-01-10"), [
          {
            kind: "payment",
            direction: "out",
            from: "wallet",
            to: "recipient",
            currency: "XLM",
            amountStroops: 30_0000000n,
          },
        ]),
        // Second disposal: should take from batch 3
        createTx(new Date("2025-01-11"), [
          {
            kind: "payment",
            direction: "out",
            from: "wallet",
            to: "recipient",
            currency: "XLM",
            amountStroops: 15_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.4,
        "XLM:2025-01-02": 0.5,
        "XLM:2025-01-03": 0.6,
        "XLM:2025-01-10": 0.7,
        "XLM:2025-01-11": 0.7,
      });

      const result = computeFifoFills(txs, priceBook);

      expect(result.fills).toHaveLength(3);

      // First disposal creates 2 fills
      expect(result.fills[0].batchId).toBe("XLM#0001");
      expect(result.fills[0].amountStroops).toBe(10_0000000n);

      expect(result.fills[1].batchId).toBe("XLM#0002");
      expect(result.fills[1].amountStroops).toBe(20_0000000n);

      // Second disposal takes from third batch
      expect(result.fills[2].batchId).toBe("XLM#0003");
      expect(result.fills[2].amountStroops).toBe(15_0000000n);
      expect(result.fills[2].acqPriceMicro).toBe(600_000n);

      // Final state
      expect(result.endingBatches.XLM[0].qtyRemainingStroops).toBe(0n);
      expect(result.endingBatches.XLM[1].qtyRemainingStroops).toBe(0n);
      expect(result.endingBatches.XLM[2].qtyRemainingStroops).toBe(
        15_0000000n,
      );
    });

    it("should skip empty batches and find next available", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 20_0000000n,
          },
        ]),
        createTx(new Date("2025-01-02"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "XLM",
            amountStroops: 30_0000000n,
          },
        ]),
        // Deplete first batch
        createTx(new Date("2025-01-05"), [
          {
            kind: "payment",
            direction: "out",
            from: "wallet",
            to: "recipient",
            currency: "XLM",
            amountStroops: 20_0000000n,
          },
        ]),
        // Should take from second batch
        createTx(new Date("2025-01-06"), [
          {
            kind: "payment",
            direction: "out",
            from: "wallet",
            to: "recipient",
            currency: "XLM",
            amountStroops: 10_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.4,
        "XLM:2025-01-02": 0.5,
        "XLM:2025-01-05": 0.6,
        "XLM:2025-01-06": 0.6,
      });

      const result = computeFifoFills(txs, priceBook);

      expect(result.fills).toHaveLength(2);

      // First fill depletes batch 1
      expect(result.fills[0].batchId).toBe("XLM#0001");
      expect(result.endingBatches.XLM[0].qtyRemainingStroops).toBe(0n);

      // Second fill correctly skips empty batch 1 and uses batch 2
      expect(result.fills[1].batchId).toBe("XLM#0002");
      expect(result.fills[1].acqPriceMicro).toBe(500_000n);
    });
  });

  describe("Gain/Loss Calculation Tests", () => {
    it("should calculate capital gain when disposal price > acquisition price", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 100_0000000n,
          },
        ]),
        createTx(new Date("2025-01-10"), [
          {
            kind: "payment",
            direction: "out",
            from: "wallet",
            to: "recipient",
            currency: "XLM",
            amountStroops: 50_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.4, // Buy at 0.4 EUR
        "XLM:2025-01-10": 0.8, // Sell at 0.8 EUR
      });

      const result = computeFifoFills(txs, priceBook);

      const fill = result.fills[0];
      // Cost: 50 XLM * 0.4 EUR = 20 EUR = 2000 cents
      expect(fill.costCents).toBe(2000n);
      // Proceeds: 50 XLM * 0.8 EUR = 40 EUR = 4000 cents
      expect(fill.proceedsCents).toBe(4000n);
      // Gain: 4000 - 2000 = 2000 cents
      expect(fill.gainLossCents).toBe(2000n);
      expect(fill.gainLossCents).toBeGreaterThan(0n);
    });

    it("should calculate capital loss when disposal price < acquisition price", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 100_0000000n,
          },
        ]),
        createTx(new Date("2025-01-10"), [
          {
            kind: "payment",
            direction: "out",
            from: "wallet",
            to: "recipient",
            currency: "XLM",
            amountStroops: 50_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.8, // Buy at 0.8 EUR
        "XLM:2025-01-10": 0.4, // Sell at 0.4 EUR
      });

      const result = computeFifoFills(txs, priceBook);

      const fill = result.fills[0];
      // Cost: 50 XLM * 0.8 EUR = 40 EUR = 4000 cents
      expect(fill.costCents).toBe(4000n);
      // Proceeds: 50 XLM * 0.4 EUR = 20 EUR = 2000 cents
      expect(fill.proceedsCents).toBe(2000n);
      // Loss: 2000 - 4000 = -2000 cents
      expect(fill.gainLossCents).toBe(-2000n);
      expect(fill.gainLossCents).toBeLessThan(0n);
    });

    it("should calculate zero gain when prices are equal", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 100_0000000n,
          },
        ]),
        createTx(new Date("2025-01-10"), [
          {
            kind: "payment",
            direction: "out",
            from: "wallet",
            to: "recipient",
            currency: "XLM",
            amountStroops: 50_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.5,
        "XLM:2025-01-10": 0.5,
      });

      const result = computeFifoFills(txs, priceBook);

      const fill = result.fills[0];
      expect(fill.costCents).toBe(fill.proceedsCents);
      expect(fill.gainLossCents).toBe(0n);
    });

    it("should calculate negative gain for fee disposals (0 proceeds)", () => {
      const txs = [
        createTx(
          new Date("2025-01-01"),
          [
            {
              kind: "create_account",
              from: "funder",
              to: "wallet",
              amountStroops: 100_0000000n,
            },
          ],
          5000000n, // 0.5 XLM fee
        ),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.5,
      });

      const result = computeFifoFills(txs, priceBook);

      const fill = result.fills[0];
      expect(fill.dispKind).toBe("network_fee");
      expect(fill.proceedsCents).toBe(0n);
      expect(fill.costCents).toBeGreaterThan(0n);
      expect(fill.gainLossCents).toBe(-fill.costCents); // Pure loss
      expect(fill.gainLossCents).toBeLessThan(0n);
    });

    it("should calculate implied swap pricing correctly", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 100_0000000n, // 100 XLM
          },
        ]),
        createTx(new Date("2025-01-10"), [
          {
            kind: "swap",
            sourceCurrency: "XLM",
            sourceAmountStroops: 100_0000000n, // Swap 100 XLM
            destinationCurrency: "USDC",
            destinationAmountStroops: 50_0000000n, // For 50 USDC
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.4, // Bought at 0.4 EUR
        "USDC:2025-01-10": 0.95, // USDC worth 0.95 EUR at swap time
      });

      const result = computeFifoFills(txs, priceBook);

      const fill = result.fills[0];
      expect(fill.currency).toBe("XLM");

      // Cost basis: 100 XLM * 0.4 EUR = 40 EUR = 4000 cents
      expect(fill.costCents).toBe(4000n);

      // Implied proceeds: 50 USDC * 0.95 EUR / 100 XLM = 0.475 EUR per XLM
      // Proceeds: 100 XLM * 0.475 EUR = 47.5 EUR = 4750 cents
      expect(fill.dispPriceMicro).toBe(475_000n);
      expect(fill.proceedsCents).toBe(4750n);

      // Gain: 4750 - 4000 = 750 cents
      expect(fill.gainLossCents).toBe(750n);
    });
  });

  describe("Price Lookup Tests", () => {
    it("should use priceBook correctly for XLM and USDC", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 100_0000000n,
          },
        ]),
        createTx(new Date("2025-01-02"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "USDC",
            amountStroops: 50_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.45,
        "USDC:2025-01-02": 0.92,
      });

      const result = computeFifoFills(txs, priceBook);

      expect(result.endingBatches.XLM[0].priceMicroAtAcq).toBe(450_000n);
      expect(result.endingBatches.USDC[0].priceMicroAtAcq).toBe(920_000n);
    });

    it("should never look up EURC in priceBook (always use par)", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "EURC",
            amountStroops: 100_0000000n,
          },
        ]),
        createTx(new Date("2025-01-02"), [
          {
            kind: "payment",
            direction: "out",
            from: "wallet",
            to: "recipient",
            currency: "EURC",
            amountStroops: 50_0000000n,
          },
        ]),
      ];

      // Intentionally empty priceBook - EURC should not need it
      const priceBook = createPriceBook({});

      const result = computeFifoFills(txs, priceBook);

      // Should succeed without EURC prices
      expect(result.fills).toHaveLength(1);
      expect(result.fills[0].acqPriceMicro).toBe(MICRO_PER_EUR);
      expect(result.fills[0].dispPriceMicro).toBe(MICRO_PER_EUR);
    });

    it("should throw error for missing XLM price", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 100_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        // Missing XLM:2025-01-01
      });

      expect(() => computeFifoFills(txs, priceBook)).toThrow(
        "Missing price for XLM:2025-01-01",
      );
    });

    it("should throw error for missing USDC price", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "USDC",
            amountStroops: 100_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        // Missing USDC:2025-01-01
      });

      expect(() => computeFifoFills(txs, priceBook)).toThrow(
        "Missing price for USDC:2025-01-01",
      );
    });
  });

  describe("Error Conditions", () => {
    it("should throw error on XLM underflow", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 50_0000000n,
          },
        ]),
        createTx(new Date("2025-01-10"), [
          {
            kind: "payment",
            direction: "out",
            from: "wallet",
            to: "recipient",
            currency: "XLM",
            amountStroops: 100_0000000n, // Try to send more than we have
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.5,
        "XLM:2025-01-10": 0.5,
      });

      expect(() => computeFifoFills(txs, priceBook)).toThrow(
        /FIFO underflow for XLM/,
      );
    });

    it("should throw error on USDC underflow", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "USDC",
            amountStroops: 50_0000000n,
          },
        ]),
        createTx(new Date("2025-01-10"), [
          {
            kind: "payment",
            direction: "out",
            from: "wallet",
            to: "recipient",
            currency: "USDC",
            amountStroops: 100_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "USDC:2025-01-01": 0.95,
        "USDC:2025-01-10": 0.95,
      });

      expect(() => computeFifoFills(txs, priceBook)).toThrow(
        /FIFO underflow for USDC/,
      );
    });

    it("should throw error on EURC underflow", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "EURC",
            amountStroops: 50_0000000n,
          },
        ]),
        createTx(new Date("2025-01-10"), [
          {
            kind: "payment",
            direction: "out",
            from: "wallet",
            to: "recipient",
            currency: "EURC",
            amountStroops: 100_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({});

      expect(() => computeFifoFills(txs, priceBook)).toThrow(/EURC underflow/);
    });

    it("should throw error mid-transaction when underflow occurs", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 100_0000000n,
          },
        ]),
        // First disposal succeeds
        createTx(new Date("2025-01-05"), [
          {
            kind: "payment",
            direction: "out",
            from: "wallet",
            to: "recipient",
            currency: "XLM",
            amountStroops: 50_0000000n,
          },
        ]),
        // Second disposal fails - not enough remaining
        createTx(new Date("2025-01-06"), [
          {
            kind: "payment",
            direction: "out",
            from: "wallet",
            to: "recipient",
            currency: "XLM",
            amountStroops: 100_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.5,
        "XLM:2025-01-05": 0.5,
        "XLM:2025-01-06": 0.5,
      });

      expect(() => computeFifoFills(txs, priceBook)).toThrow(
        /FIFO underflow for XLM/,
      );
    });

    it("should provide clear error with currency and date on underflow", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 10_0000000n,
          },
        ]),
        createTx(new Date("2025-02-15"), [
          {
            kind: "payment",
            direction: "out",
            from: "wallet",
            to: "recipient",
            currency: "XLM",
            amountStroops: 50_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.5,
        "XLM:2025-02-15": 0.5,
      });

      try {
        computeFifoFills(txs, priceBook);
        expect.fail("Should have thrown error");
      } catch (error: unknown) {
        const errorMessage = (error as Error).message;
        expect(errorMessage).toContain("XLM");
        expect(errorMessage).toContain("2025-02-15");
      }
    });
  });

  describe("EURC Special Cases", () => {
    it("should always value EURC cost at par (1:1)", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "EURC",
            amountStroops: 100_0000000n,
          },
        ]),
        createTx(new Date("2025-01-10"), [
          {
            kind: "payment",
            direction: "out",
            from: "wallet",
            to: "recipient",
            currency: "EURC",
            amountStroops: 50_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({});

      const result = computeFifoFills(txs, priceBook);

      const fill = result.fills[0];
      expect(fill.acqPriceMicro).toBe(MICRO_PER_EUR);
      expect(fill.dispPriceMicro).toBe(MICRO_PER_EUR);
      // Cost and proceeds should be equal (50 EURC = 50 EUR)
      expect(fill.costCents).toBe(5000n);
      expect(fill.proceedsCents).toBe(5000n);
      expect(fill.gainLossCents).toBe(0n);
    });

    it("should handle EURC in swaps with par cost basis", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "EURC",
            amountStroops: 100_0000000n,
          },
        ]),
        createTx(new Date("2025-01-10"), [
          {
            kind: "swap",
            sourceCurrency: "EURC",
            sourceAmountStroops: 100_0000000n,
            destinationCurrency: "XLM",
            destinationAmountStroops: 200_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-10": 0.5,
      });

      const result = computeFifoFills(txs, priceBook);

      const fill = result.fills[0];
      expect(fill.currency).toBe("EURC");
      expect(fill.acqPriceMicro).toBe(MICRO_PER_EUR);
      // Cost: 100 EURC @ par = 100 EUR = 10000 cents
      expect(fill.costCents).toBe(10000n);
      // Proceeds: 200 XLM @ 0.5 EUR / 100 EURC = 1.0 EUR per EURC
      expect(fill.proceedsCents).toBe(10000n);
      expect(fill.gainLossCents).toBe(0n);
    });

    it("should handle EURC swap to lower-valued asset", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "EURC",
            amountStroops: 100_0000000n,
          },
        ]),
        createTx(new Date("2025-01-10"), [
          {
            kind: "swap",
            sourceCurrency: "EURC",
            sourceAmountStroops: 100_0000000n,
            destinationCurrency: "XLM",
            destinationAmountStroops: 150_0000000n, // 150 XLM
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-10": 0.6, // 150 XLM * 0.6 = 90 EUR
      });

      const result = computeFifoFills(txs, priceBook);

      const fill = result.fills[0];
      expect(fill.currency).toBe("EURC");
      // Cost: 100 EURC @ par = 100 EUR = 10000 cents
      expect(fill.costCents).toBe(10000n);
      // Proceeds: 150 XLM * 0.6 EUR = 90 EUR = 9000 cents
      expect(fill.proceedsCents).toBe(9000n);
      // Loss: 9000 - 10000 = -1000 cents
      expect(fill.gainLossCents).toBe(-1000n);
    });

    it("should accumulate EURC in single par batch across multiple acquisitions", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "EURC",
            amountStroops: 100_0000000n,
          },
        ]),
        createTx(new Date("2025-01-05"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "EURC",
            amountStroops: 50_0000000n,
          },
        ]),
        createTx(new Date("2025-01-10"), [
          {
            kind: "payment",
            direction: "out",
            from: "wallet",
            to: "recipient",
            currency: "EURC",
            amountStroops: 75_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({});

      const result = computeFifoFills(txs, priceBook);

      // Single fill (not multiple like XLM/USDC would be)
      expect(result.fills).toHaveLength(1);
      expect(result.fills[0].batchId).toBe("EURC#PAR");
      expect(result.fills[0].amountStroops).toBe(75_0000000n);

      // Ending batch has 75 remaining (100 + 50 - 75)
      expect(result.endingBatches.EURC[0].qtyRemainingStroops).toBe(
        75_0000000n,
      );
    });

    it("should handle EURC fee with par cost and zero proceeds", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "EURC",
            amountStroops: 100_0000000n,
          },
        ]),
        createTx(new Date("2025-01-05"), [
          {
            kind: "swap_fee",
            from: "wallet",
            to: "protocol",
            currency: "EURC",
            amountStroops: 5_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({});

      const result = computeFifoFills(txs, priceBook);

      const fill = result.fills[0];
      expect(fill.dispKind).toBe("swap_fee");
      expect(fill.acqPriceMicro).toBe(MICRO_PER_EUR);
      expect(fill.dispPriceMicro).toBe(0n);
      // Cost: 5 EURC @ par = 5 EUR = 500 cents
      expect(fill.costCents).toBe(500n);
      expect(fill.proceedsCents).toBe(0n);
      expect(fill.gainLossCents).toBe(-500n);
    });
  });

  describe("Swap/Trade Complex Scenarios", () => {
    it("should handle XLM → USDC swap", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 200_0000000n, // 200 XLM
          },
        ]),
        createTx(new Date("2025-01-10"), [
          {
            kind: "swap",
            sourceCurrency: "XLM",
            sourceAmountStroops: 100_0000000n, // Swap 100 XLM
            destinationCurrency: "USDC",
            destinationAmountStroops: 45_0000000n, // For 45 USDC
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.4,
        "USDC:2025-01-10": 0.95,
      });

      const result = computeFifoFills(txs, priceBook);

      // One disposal fill for XLM
      expect(result.fills).toHaveLength(1);
      const fill = result.fills[0];
      expect(fill.currency).toBe("XLM");
      expect(fill.dispKind).toBe("swap_out");

      // Cost: 100 XLM @ 0.4 EUR = 40 EUR = 4000 cents
      expect(fill.costCents).toBe(4000n);

      // Implied proceeds: 45 USDC @ 0.95 EUR = 42.75 EUR
      // Per XLM: 42.75 / 100 = 0.4275 EUR
      expect(fill.dispPriceMicro).toBe(427_500n);
      expect(fill.proceedsCents).toBe(4275n);

      // Gain: 4275 - 4000 = 275 cents
      expect(fill.gainLossCents).toBe(275n);

      // Check acquired USDC
      expect(result.endingBatches.USDC).toHaveLength(1);
      expect(result.endingBatches.USDC[0].acqKind).toBe("swap_in");
      expect(result.endingBatches.USDC[0].qtyRemainingStroops).toBe(
        45_0000000n,
      );
      expect(result.endingBatches.USDC[0].priceMicroAtAcq).toBe(950_000n);
    });

    it("should handle USDC → XLM swap", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "USDC",
            amountStroops: 100_0000000n,
          },
        ]),
        createTx(new Date("2025-01-10"), [
          {
            kind: "swap",
            sourceCurrency: "USDC",
            sourceAmountStroops: 50_0000000n, // Swap 50 USDC
            destinationCurrency: "XLM",
            destinationAmountStroops: 100_0000000n, // For 100 XLM
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "USDC:2025-01-01": 0.92,
        "XLM:2025-01-10": 0.5,
      });

      const result = computeFifoFills(txs, priceBook);

      expect(result.fills).toHaveLength(1);
      const fill = result.fills[0];
      expect(fill.currency).toBe("USDC");
      expect(fill.dispKind).toBe("swap_out");

      // Cost: 50 USDC @ 0.92 EUR = 46 EUR = 4600 cents
      expect(fill.costCents).toBe(4600n);

      // Implied proceeds: 100 XLM @ 0.5 EUR = 50 EUR
      // Per USDC: 50 / 50 = 1.0 EUR
      expect(fill.dispPriceMicro).toBe(1_000_000n);
      expect(fill.proceedsCents).toBe(5000n);

      // Gain: 5000 - 4600 = 400 cents
      expect(fill.gainLossCents).toBe(400n);

      // Check acquired XLM
      expect(result.endingBatches.XLM).toHaveLength(1);
      expect(result.endingBatches.XLM[0].acqKind).toBe("swap_in");
      expect(result.endingBatches.XLM[0].qtyRemainingStroops).toBe(
        100_0000000n,
      );
    });

    it("should handle EURC → XLM swap", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "EURC",
            amountStroops: 200_0000000n,
          },
        ]),
        createTx(new Date("2025-01-10"), [
          {
            kind: "swap",
            sourceCurrency: "EURC",
            sourceAmountStroops: 100_0000000n,
            destinationCurrency: "XLM",
            destinationAmountStroops: 250_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-10": 0.4,
      });

      const result = computeFifoFills(txs, priceBook);

      const fill = result.fills[0];
      expect(fill.currency).toBe("EURC");

      // EURC cost always at par
      expect(fill.acqPriceMicro).toBe(MICRO_PER_EUR);
      expect(fill.costCents).toBe(10000n); // 100 EURC = 100 EUR

      // Proceeds: 250 XLM @ 0.4 EUR = 100 EUR
      expect(fill.proceedsCents).toBe(10000n);
      expect(fill.gainLossCents).toBe(0n);

      // Check acquired XLM
      expect(result.endingBatches.XLM).toHaveLength(1);
      expect(result.endingBatches.XLM[0].qtyRemainingStroops).toBe(
        250_0000000n,
      );
    });

    it("should handle large swap consuming multiple old batches", () => {
      const txs = [
        // Acquire XLM in 3 batches
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 50_0000000n,
          },
        ]),
        createTx(new Date("2025-01-02"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "XLM",
            amountStroops: 60_0000000n,
          },
        ]),
        createTx(new Date("2025-01-03"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "XLM",
            amountStroops: 40_0000000n,
          },
        ]),
        // Large swap consuming all 3 batches
        createTx(new Date("2025-01-10"), [
          {
            kind: "swap",
            sourceCurrency: "XLM",
            sourceAmountStroops: 140_0000000n, // 50 + 60 + 30
            destinationCurrency: "USDC",
            destinationAmountStroops: 70_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.4,
        "XLM:2025-01-02": 0.45,
        "XLM:2025-01-03": 0.5,
        "USDC:2025-01-10": 1.0,
      });

      const result = computeFifoFills(txs, priceBook);

      // Should create 3 fills (one per batch)
      expect(result.fills).toHaveLength(3);

      // First fill: entire batch 1
      expect(result.fills[0].batchId).toBe("XLM#0001");
      expect(result.fills[0].amountStroops).toBe(50_0000000n);
      expect(result.fills[0].acqPriceMicro).toBe(400_000n);

      // Second fill: entire batch 2
      expect(result.fills[1].batchId).toBe("XLM#0002");
      expect(result.fills[1].amountStroops).toBe(60_0000000n);
      expect(result.fills[1].acqPriceMicro).toBe(450_000n);

      // Third fill: partial batch 3
      expect(result.fills[2].batchId).toBe("XLM#0003");
      expect(result.fills[2].amountStroops).toBe(30_0000000n);
      expect(result.fills[2].acqPriceMicro).toBe(500_000n);

      // All fills should have same disposal price (implied from destination)
      const impliedPrice = 500_000n; // 70 USDC @ 1.0 EUR / 140 XLM
      expect(result.fills[0].dispPriceMicro).toBe(impliedPrice);
      expect(result.fills[1].dispPriceMicro).toBe(impliedPrice);
      expect(result.fills[2].dispPriceMicro).toBe(impliedPrice);

      // Check remaining inventory
      expect(result.endingBatches.XLM[0].qtyRemainingStroops).toBe(0n);
      expect(result.endingBatches.XLM[1].qtyRemainingStroops).toBe(0n);
      expect(result.endingBatches.XLM[2].qtyRemainingStroops).toBe(
        10_0000000n,
      );
    });

    it("should handle sell_offer identically to swap", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 100_0000000n,
          },
        ]),
        createTx(new Date("2025-01-10"), [
          {
            kind: "sell_offer",
            sourceCurrency: "XLM",
            sourceAmountStroops: 50_0000000n,
            destinationCurrency: "USDC",
            destinationAmountStroops: 25_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.4,
        "USDC:2025-01-10": 0.95,
      });

      const result = computeFifoFills(txs, priceBook);

      expect(result.fills).toHaveLength(1);
      const fill = result.fills[0];
      expect(fill.currency).toBe("XLM");
      expect(fill.dispKind).toBe("swap_out"); // Treated as swap_out

      // Should calculate implied price same as swap
      // 25 USDC @ 0.95 = 23.75 EUR / 50 XLM = 0.475 EUR per XLM
      expect(fill.dispPriceMicro).toBe(475_000n);

      // Check acquired USDC batch
      expect(result.endingBatches.USDC).toHaveLength(1);
      expect(result.endingBatches.USDC[0].acqKind).toBe("swap_in");
    });
  });

  describe("Ending Inventory Tests", () => {
    it("should return correct endingBatches structure per currency", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 100_0000000n,
          },
        ]),
        createTx(new Date("2025-01-02"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "USDC",
            amountStroops: 50_0000000n,
          },
        ]),
        createTx(new Date("2025-01-03"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "EURC",
            amountStroops: 30_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.5,
        "USDC:2025-01-02": 0.95,
      });

      const result = computeFifoFills(txs, priceBook);

      // Should have all three currencies in endingBatches
      expect(result.endingBatches).toHaveProperty("XLM");
      expect(result.endingBatches).toHaveProperty("USDC");
      expect(result.endingBatches).toHaveProperty("EURC");

      expect(Array.isArray(result.endingBatches.XLM)).toBe(true);
      expect(Array.isArray(result.endingBatches.USDC)).toBe(true);
      expect(Array.isArray(result.endingBatches.EURC)).toBe(true);
    });

    it("should have accurate qtyRemainingStroops after all disposals", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 100_0000000n,
          },
        ]),
        createTx(new Date("2025-01-05"), [
          {
            kind: "payment",
            direction: "out",
            from: "wallet",
            to: "recipient",
            currency: "XLM",
            amountStroops: 30_0000000n,
          },
        ]),
        createTx(
          new Date("2025-01-06"),
          [
            {
              kind: "payment",
              direction: "out",
              from: "wallet",
              to: "recipient",
              currency: "XLM",
              amountStroops: 20_0000000n,
            },
          ],
          5000000n, // 0.5 XLM fee
        ),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.5,
        "XLM:2025-01-05": 0.5,
        "XLM:2025-01-06": 0.5,
      });

      const result = computeFifoFills(txs, priceBook);

      // Started with 100, sent 30, sent 20, paid 0.5 fee
      // Remaining: 100 - 30 - 20 - 0.5 = 49.5 XLM
      expect(result.endingBatches.XLM[0].qtyRemainingStroops).toBe(
        49_5000000n,
      );
    });

    it("should include zero-remaining batches in inventory", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 50_0000000n,
          },
        ]),
        createTx(new Date("2025-01-02"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "XLM",
            amountStroops: 50_0000000n,
          },
        ]),
        // Deplete first batch completely
        createTx(new Date("2025-01-10"), [
          {
            kind: "payment",
            direction: "out",
            from: "wallet",
            to: "recipient",
            currency: "XLM",
            amountStroops: 50_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.5,
        "XLM:2025-01-02": 0.5,
        "XLM:2025-01-10": 0.5,
      });

      const result = computeFifoFills(txs, priceBook);

      // Both batches should still be in inventory
      expect(result.endingBatches.XLM).toHaveLength(2);
      expect(result.endingBatches.XLM[0].qtyRemainingStroops).toBe(0n);
      expect(result.endingBatches.XLM[1].qtyRemainingStroops).toBe(
        50_0000000n,
      );
    });

    it("should always have EURC par batch present", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 100_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.5,
      });

      const result = computeFifoFills(txs, priceBook);

      // EURC batch should always exist even if never used
      expect(result.endingBatches.EURC).toHaveLength(1);
      expect(result.endingBatches.EURC[0].batchId).toBe("EURC#PAR");
      expect(result.endingBatches.EURC[0].priceMicroAtAcq).toBe(MICRO_PER_EUR);
      expect(result.endingBatches.EURC[0].qtyRemainingStroops).toBe(0n);
    });

    it("should accumulate EURC totals in single batch", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "EURC",
            amountStroops: 100_0000000n,
          },
        ]),
        createTx(new Date("2025-01-05"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "EURC",
            amountStroops: 50_0000000n,
          },
        ]),
        createTx(new Date("2025-01-10"), [
          {
            kind: "payment",
            direction: "out",
            from: "wallet",
            to: "recipient",
            currency: "EURC",
            amountStroops: 80_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({});

      const result = computeFifoFills(txs, priceBook);

      const eurcBatch = result.endingBatches.EURC[0];
      expect(eurcBatch.qtyInitialStroops).toBe(150_0000000n); // 100 + 50
      expect(eurcBatch.qtyRemainingStroops).toBe(70_0000000n); // 150 - 80
    });

    it("should track multiple XLM batches with correct remaining quantities", () => {
      const txs = [
        createTx(new Date("2025-01-01"), [
          {
            kind: "create_account",
            from: "funder",
            to: "wallet",
            amountStroops: 100_0000000n,
          },
        ]),
        createTx(new Date("2025-01-02"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "XLM",
            amountStroops: 50_0000000n,
          },
        ]),
        createTx(new Date("2025-01-03"), [
          {
            kind: "payment",
            direction: "in",
            from: "sender",
            to: "wallet",
            currency: "XLM",
            amountStroops: 75_0000000n,
          },
        ]),
        // Dispose from first batch only
        createTx(new Date("2025-01-10"), [
          {
            kind: "payment",
            direction: "out",
            from: "wallet",
            to: "recipient",
            currency: "XLM",
            amountStroops: 60_0000000n,
          },
        ]),
      ];

      const priceBook = createPriceBook({
        "XLM:2025-01-01": 0.4,
        "XLM:2025-01-02": 0.5,
        "XLM:2025-01-03": 0.6,
        "XLM:2025-01-10": 0.7,
      });

      const result = computeFifoFills(txs, priceBook);

      expect(result.endingBatches.XLM).toHaveLength(3);
      // Batch 1: 100 - 60 = 40 remaining
      expect(result.endingBatches.XLM[0].qtyRemainingStroops).toBe(
        40_0000000n,
      );
      // Batch 2: untouched
      expect(result.endingBatches.XLM[1].qtyRemainingStroops).toBe(
        50_0000000n,
      );
      // Batch 3: untouched
      expect(result.endingBatches.XLM[2].qtyRemainingStroops).toBe(
        75_0000000n,
      );
    });
  });
});
