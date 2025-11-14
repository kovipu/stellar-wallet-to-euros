import { describe, it, expect } from "vitest";
import { buildEventsCsv, acqKindFi, dispKindFi } from "./fifo-csv";
import { Batch, Fill } from "../report/fifo";

describe("buildEventsCsv", () => {
  it("should generate empty CSV with headers when no events", () => {
    const batches: Record<Currency, Batch[]> = { XLM: [], USDC: [], EURC: [] };
    const fills: Fill[] = [];

    const csv = buildEventsCsv(batches, fills);

    expect(csv).toContain("Tyyppi,Luovutushetki (UTC),Toiminto,Valuutta,Määrä");
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

    const csv = buildEventsCsv(batches, fills);

    expect(csv).toContain("Hankinta"); // Type
    expect(csv).toContain("Maksu sisään"); // Action (acqKindFi)
    expect(csv).toContain("XLM"); // Currency
    expect(csv).toContain("1000,0000000"); // Amount
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

    const csv = buildEventsCsv(batches, fills);

    expect(csv).toContain("Luovutus"); // Type
    expect(csv).toContain("Vaihto (ulos)"); // Action (dispKindFi)
    expect(csv).toContain("XLM"); // Currency
    expect(csv).toContain("500,0000000"); // Amount
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

    const csv = buildEventsCsv(batches, fills);

    expect(csv).not.toContain("EURC#PAR");
    expect(csv.split("\n").length).toBe(2); // Only header + empty line
  });

  it("should sort events by currency, then type (acquisition before disposal), then timestamp", () => {
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

    const csv = buildEventsCsv(batches, fills);
    const lines = csv.split("\n");

    // Should be: header, USDC acquisition, XLM acquisition, XLM disposal, empty
    expect(lines.length).toBe(5);
    expect(lines[1]).toContain("USDC"); // USDC comes before XLM alphabetically
    expect(lines[2]).toContain("XLM");
    expect(lines[2]).toContain("Hankinta"); // Acquisition before disposal for XLM
    expect(lines[3]).toContain("XLM");
    expect(lines[3]).toContain("Luovutus"); // Disposal after acquisition
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

    const csv = buildEventsCsv(batches, fills);
    const lines = csv.split("\n");

    expect(lines[1]).toContain("XLM#0002"); // Earlier timestamp first
    expect(lines[2]).toContain("XLM#0001"); // Later timestamp second
  });
});
