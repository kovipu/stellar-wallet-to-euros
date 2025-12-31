import { describe, it, expect } from "vitest";
import { buildEventsCsv, acqKindFi, dispKindFi } from "./fifo-csv";
import { Batch, Fill } from "../report/fifo";

// Mock txRows with final balances
const mockTxRows: TxRow[] = [
  {
    transactionHash: "mock",
    date: new Date("2025-01-01T00:00:00Z"),
    ops: [],
    feeStroops: 0n,
    balances: { XLM: 0n, USDC: 0n, EURC: 0n },
  },
];

describe("buildEventsCsv", () => {
  it("should generate empty CSV with headers when no events", () => {
    const batches: Record<Currency, Batch[]> = { XLM: [], USDC: [], EURC: [] };
    const fills: Fill[] = [];

    const csv = buildEventsCsv(batches, fills, mockTxRows);

    expect(csv).toContain(
      "Valuutta,Erä ID,Tyyppi,Toiminto,Hankintahetki (UTC),Luovutushetki (UTC),Erän koko (kpl),Erää jäljellä (kpl)",
    );
    expect(csv.split("\n").length).toBe(2); // header + empty line
  });

  it("should include acquisitions (batches)", () => {
    const batch: Batch = {
      batchId: "XLM#0001",
      currency: "XLM",
      acquiredAt: new Date("2025-04-01T10:00:00Z"),
      qtyInitialStroops: 1000_0000000n, // 1000 XLM
      qtyRemainingStroops: 1000_0000000n,
      priceMicroAtAcq: 250000n, // 0.25 EUR
      acqKind: "payment_in",
      acqTxHash: "abc123",
    };
    const batches: Record<Currency, Batch[]> = {
      XLM: [batch],
      USDC: [],
      EURC: [],
    };
    const fills: Fill[] = [];

    const csv = buildEventsCsv(batches, fills, mockTxRows);

    expect(csv).toContain("Hankinta"); // Type
    expect(csv).toContain("Maksu sisään"); // Action (acqKindFi)
    expect(csv).toContain("XLM"); // Currency
    expect(csv).toContain("1000,0000000"); // Amount (positive for acquisition)
    expect(csv).toContain("XLM#0001"); // Batch ID
    expect(csv).toContain("2025-04-01T10:00:00.000Z"); // Acquisition time
    expect(csv).toContain("0,250000"); // Acquisition price
    expect(csv).toContain("250,00"); // Cost (1000 * 0.25)
    expect(csv).toContain("abc123"); // Transaction hash
  });

  it("should include disposals (fills)", () => {
    const fill: Fill = {
      batchId: "XLM#0001",
      currency: "XLM",
      amountStroops: 500_0000000n, // 500 XLM
      acquiredAt: new Date("2025-04-01T10:00:00Z"),
      disposedAt: new Date("2025-04-05T15:00:00Z"),
      acqPriceMicro: 250000n, // 0.25 EUR
      dispPriceMicro: 300000n, // 0.30 EUR
      costCents: 12500n, // 125.00 EUR
      proceedsCents: 15000n, // 150.00 EUR
      gainLossCents: 2500n, // 25.00 EUR gain
      dispKind: "swap_out",
      txHash: "def456",
    };
    const batches: Record<Currency, Batch[]> = { XLM: [], USDC: [], EURC: [] };
    const fills: Fill[] = [fill];

    const csv = buildEventsCsv(batches, fills, mockTxRows);

    expect(csv).toContain("Luovutus"); // Type
    expect(csv).toContain("Vaihto (ulos)"); // Action (dispKindFi)
    expect(csv).toContain("XLM"); // Currency
    expect(csv).toContain("-500,0000000"); // Amount (negative for disposal)
    expect(csv).toContain("XLM#0001"); // Batch ID
    expect(csv).toContain("2025-04-01T10:00:00.000Z"); // Acquisition time
    expect(csv).toContain("2025-04-05T15:00:00.000Z"); // Disposal time
    expect(csv).toContain("0,250000"); // Acquisition price
    expect(csv).toContain("0,300000"); // Disposal price
    expect(csv).toContain("150,00"); // Proceeds
    expect(csv).toContain("125,00"); // Cost
    expect(csv).toContain("25,00"); // Gain/loss
    expect(csv).toContain("def456"); // Transaction hash
  });

  it("should skip unused EURC par batch", () => {
    const eurcParBatch: Batch = {
      batchId: "EURC#PAR",
      currency: "EURC",
      acquiredAt: new Date("2025-01-01T00:00:00Z"),
      qtyInitialStroops: 0n, // Never used
      qtyRemainingStroops: 0n,
      priceMicroAtAcq: 1000000n,
      acqKind: "eurc_par",
      acqTxHash: "par",
    };
    const batches: Record<Currency, Batch[]> = {
      XLM: [],
      USDC: [],
      EURC: [eurcParBatch],
    };
    const fills: Fill[] = [];

    const csv = buildEventsCsv(batches, fills, mockTxRows);

    expect(csv).not.toContain("EURC#PAR");
    expect(csv.split("\n").length).toBe(2); // Only header + empty line
  });

  it("should sort events by currency, then timestamp", () => {
    const usdcBatch: Batch = {
      batchId: "USDC#0001",
      currency: "USDC",
      acquiredAt: new Date("2025-04-02T10:00:00Z"),
      qtyInitialStroops: 100_0000000n,
      qtyRemainingStroops: 100_0000000n,
      priceMicroAtAcq: 950000n,
      acqKind: "payment_in",
      acqTxHash: "abc",
    };
    const xlmBatch: Batch = {
      batchId: "XLM#0001",
      currency: "XLM",
      acquiredAt: new Date("2025-04-01T10:00:00Z"),
      qtyInitialStroops: 1000_0000000n,
      qtyRemainingStroops: 1000_0000000n,
      priceMicroAtAcq: 250000n,
      acqKind: "payment_in",
      acqTxHash: "def",
    };
    const xlmFill: Fill = {
      batchId: "XLM#0001",
      currency: "XLM",
      amountStroops: 500_0000000n,
      acquiredAt: new Date("2025-04-01T10:00:00Z"),
      disposedAt: new Date("2025-04-03T10:00:00Z"),
      acqPriceMicro: 250000n,
      dispPriceMicro: 300000n,
      costCents: 12500n,
      proceedsCents: 15000n,
      gainLossCents: 2500n,
      dispKind: "swap_out",
      txHash: "ghi",
    };

    const batches: Record<Currency, Batch[]> = {
      XLM: [xlmBatch],
      USDC: [usdcBatch],
      EURC: [],
    };
    const fills: Fill[] = [xlmFill];

    // Mock txRows with expected final balances: USDC=100, XLM=500 (1000-500)
    const testTxRows: TxRow[] = [
      {
        transactionHash: "test",
        date: new Date("2025-04-03T10:00:00Z"),
        ops: [],
        feeStroops: 0n,
        balances: { XLM: 500_0000000n, USDC: 100_0000000n, EURC: 0n },
      },
    ];

    const csv = buildEventsCsv(batches, fills, testTxRows);
    const lines = csv.split("\n");

    // Should be: header, USDC acquisition, USDC summary, XLM acquisition, XLM disposal, XLM summary, empty
    expect(lines.length).toBe(7);
    expect(lines[1]).toContain("USDC"); // USDC comes before XLM alphabetically
    expect(lines[2]).toContain("100,0000000"); // USDC summary row with ending balance
    expect(lines[3]).toContain("XLM");
    expect(lines[3]).toContain("Hankinta"); // XLM acquisition (earlier timestamp)
    expect(lines[4]).toContain("XLM");
    expect(lines[4]).toContain("Luovutus"); // XLM disposal (later timestamp)
    expect(lines[5]).toContain("500,0000000"); // XLM summary row with ending balance (1000 - 500)
  });

  it("should sort acquisitions by timestamp within same currency", () => {
    const batch1: Batch = {
      batchId: "XLM#0001",
      currency: "XLM",
      acquiredAt: new Date("2025-04-02T10:00:00Z"),
      qtyInitialStroops: 1000_0000000n,
      qtyRemainingStroops: 1000_0000000n,
      priceMicroAtAcq: 250000n,
      acqKind: "payment_in",
      acqTxHash: "abc",
    };
    const batch2: Batch = {
      batchId: "XLM#0002",
      currency: "XLM",
      acquiredAt: new Date("2025-04-01T10:00:00Z"), // Earlier
      qtyInitialStroops: 500_0000000n,
      qtyRemainingStroops: 500_0000000n,
      priceMicroAtAcq: 240000n,
      acqKind: "payment_in",
      acqTxHash: "def",
    };

    const batches: Record<Currency, Batch[]> = {
      XLM: [batch1, batch2],
      USDC: [],
      EURC: [],
    };
    const fills: Fill[] = [];

    const csv = buildEventsCsv(batches, fills, mockTxRows);
    const lines = csv.split("\n");

    expect(lines[1]).toContain("XLM#0002"); // Earlier timestamp first
    expect(lines[2]).toContain("XLM#0001"); // Later timestamp second
  });

  it("should sort disposals by timestamp", () => {
    const batch: Batch = {
      batchId: "XLM#0001",
      currency: "XLM",
      acquiredAt: new Date("2025-03-01T10:00:00Z"),
      qtyInitialStroops: 1000_0000000n,
      qtyRemainingStroops: 0n,
      priceMicroAtAcq: 250000n,
      acqKind: "payment_in",
      acqTxHash: "abc",
    };

    const fill1: Fill = {
      batchId: "XLM#0001",
      currency: "XLM",
      amountStroops: 500_0000000n,
      acquiredAt: new Date("2025-03-01T10:00:00Z"),
      disposedAt: new Date("2025-04-05T15:00:00Z"), // Later disposal
      acqPriceMicro: 250000n,
      dispPriceMicro: 300000n,
      costCents: 12500n,
      proceedsCents: 15000n,
      gainLossCents: 2500n,
      dispKind: "swap_out",
      txHash: "def",
    };

    const fill2: Fill = {
      batchId: "XLM#0001",
      currency: "XLM",
      amountStroops: 500_0000000n,
      acquiredAt: new Date("2025-03-01T10:00:00Z"),
      disposedAt: new Date("2025-04-02T10:00:00Z"), // Earlier disposal
      acqPriceMicro: 250000n,
      dispPriceMicro: 280000n,
      costCents: 12500n,
      proceedsCents: 14000n,
      gainLossCents: 1500n,
      dispKind: "payment_out",
      txHash: "ghi",
    };

    const batches: Record<Currency, Batch[]> = {
      XLM: [batch],
      USDC: [],
      EURC: [],
    };
    const fills: Fill[] = [fill1, fill2];

    const csv = buildEventsCsv(batches, fills, mockTxRows);
    const lines = csv.split("\n");

    // Should be sorted by timestamp: batch (March 1), fill2 (April 2), fill1 (April 5)
    expect(lines[1]).toContain("2025-03-01"); // Acquisition first (earliest)
    expect(lines[1]).toContain("Hankinta");
    expect(lines[2]).toContain("2025-04-02"); // Earlier disposal
    expect(lines[2]).toContain("Luovutus");
    expect(lines[3]).toContain("2025-04-05"); // Later disposal
    expect(lines[3]).toContain("Luovutus");
  });

  it("should sort events with duplicate timestamps correctly", () => {
    const batch1: Batch = {
      batchId: "XLM#0001",
      currency: "XLM",
      acquiredAt: new Date("2025-03-26T18:55:14.000Z"),
      qtyInitialStroops: 100_0000000n,
      qtyRemainingStroops: 100_0000000n,
      priceMicroAtAcq: 250000n,
      acqKind: "payment_in",
      acqTxHash: "tx1",
    };

    const batch2: Batch = {
      batchId: "XLM#0002",
      currency: "XLM",
      acquiredAt: new Date("2025-03-26T18:55:14.000Z"), // Duplicate timestamp
      qtyInitialStroops: 200_0000000n,
      qtyRemainingStroops: 200_0000000n,
      priceMicroAtAcq: 250000n,
      acqKind: "payment_in",
      acqTxHash: "tx2",
    };

    const batch3: Batch = {
      batchId: "XLM#0003",
      currency: "XLM",
      acquiredAt: new Date("2025-04-02T17:07:16.000Z"),
      qtyInitialStroops: 150_0000000n,
      qtyRemainingStroops: 150_0000000n,
      priceMicroAtAcq: 260000n,
      acqKind: "payment_in",
      acqTxHash: "tx3",
    };

    const batch4: Batch = {
      batchId: "XLM#0004",
      currency: "XLM",
      acquiredAt: new Date("2025-04-04T19:25:04.000Z"),
      qtyInitialStroops: 300_0000000n,
      qtyRemainingStroops: 300_0000000n,
      priceMicroAtAcq: 270000n,
      acqKind: "payment_in",
      acqTxHash: "tx4",
    };

    const batches: Record<Currency, Batch[]> = {
      XLM: [batch4, batch2, batch3, batch1], // Intentionally out of order
      USDC: [],
      EURC: [],
    };
    const fills: Fill[] = [];

    const csv = buildEventsCsv(batches, fills, mockTxRows);
    const lines = csv.split("\n");

    // Verify header
    expect(lines[0]).toContain("Valuutta");

    // Lines should be sorted by timestamp (2025-03-26 twice, then 2025-04-02, then 2025-04-04)
    expect(lines[1]).toContain("2025-03-26T18:55:14.000Z");
    expect(lines[2]).toContain("2025-03-26T18:55:14.000Z");
    expect(lines[3]).toContain("2025-04-02T17:07:16.000Z");
    expect(lines[4]).toContain("2025-04-04T19:25:04.000Z");

    // Both events with duplicate timestamp should appear (order between duplicates can be either way)
    const line1HasTx1 = lines[1].includes("tx1");
    const line2HasTx2 = lines[2].includes("tx2");
    const line1HasTx2 = lines[1].includes("tx2");
    const line2HasTx1 = lines[2].includes("tx1");

    // Either (line1 has tx1 AND line2 has tx2) OR (line1 has tx2 AND line2 has tx1)
    expect(
      (line1HasTx1 && line2HasTx2) || (line1HasTx2 && line2HasTx1),
    ).toBeTruthy();

    // Later timestamps should have their corresponding transaction hashes
    expect(lines[3]).toContain("tx3");
    expect(lines[4]).toContain("tx4");
  });
});
