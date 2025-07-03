import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { processTransactions } from "./script.py.js";
import { Horizon } from "@stellar/stellar-sdk";

describe("processTransactions", () => {
  beforeEach(() => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("coingecko")) {
        return Promise.resolve({
          json: () =>
            Promise.resolve({
              market_data: { current_price: { eur: 0.1 } },
            }),
        } as Response);
      }
      if (url.includes("frankfurter")) {
        return Promise.resolve({
          json: () => Promise.resolve({ rates: { EUR: 0.9 } }),
        } as Response);
      }
      return Promise.resolve({
        json: () => Promise.resolve({}),
      } as Response);
    });

    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should process a mix of create_account and payment operations", async () => {
    const accountId = "GC7...";

    const mockOperations: any = [
      {
        type: "create_account",
        starting_balance: "1000.0000000",
        created_at: "2024-01-01T00:00:00Z",
        funder: "GBX...",
      },
      {
        type: "payment",
        from: accountId,
        to: "GAZ...",
        amount: "100.0000000",
        asset_type: "native",
        created_at: "2024-01-02T00:00:00Z",
      },
      {
        type: "payment",
        from: "GAZ...",
        to: accountId,
        amount: "50.0000000",
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        created_at: "2024-01-03T00:00:00Z",
      },
    ];
    const result = await processTransactions(mockOperations, accountId, {});

    expect(result).toHaveLength(3);

    // create_account
    expect(result[0].TYPE).toBe("create_account");
    expect(result[0].originalAmount).toBe(1000);
    expect(result[0].euroValue).toBe(100);

    // sent payment
    expect(result[1].TYPE).toBe("payment_sent");
    expect(result[1].originalAmount).toBe(100);
    expect(result[1].euroValue).toBe(10);

    // received payment
    expect(result[2].TYPE).toBe("payment_received");
    expect(result[2].originalAmount).toBe(50);
    expect(result[2].euroValue).toBe(45);
  });

  it("should process path_payment_strict_send operations", async () => {
    const accountId = "GC7...";

    const mockOperations: any = [
      {
        // Sent path payment
        type: "path_payment_strict_send",
        from: accountId,
        to: "GBB...",
        source_amount: "10.0000000",
        source_asset_type: "credit_alphanum4",
        source_asset_code: "USDC",
        amount: "40.0000000",
        asset_type: "native",
        created_at: "2024-01-04T00:00:00Z",
      },
      {
        // Received path payment
        type: "path_payment_strict_send",
        from: "GBB...",
        to: accountId,
        source_amount: "100.0000000",
        source_asset_type: "native",
        amount: "20.0000000",
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        created_at: "2024-01-05T00:00:00Z",
      },
    ];

    const result = await processTransactions(mockOperations, accountId, {});

    expect(result).toHaveLength(2);

    // Sent path payment assertion
    expect(result[0].TYPE).toBe("path_payment_sent");
    expect(result[0].originalAmount).toBe(10); // 10 USDC sent
    expect(result[0].euroValue).toBe(9); // 10 * 0.9

    // Received path payment assertion
    expect(result[1].TYPE).toBe("path_payment_received");
    expect(result[1].originalAmount).toBe(20); // 20 USDC received
    expect(result[1].euroValue).toBe(18); // 20 * 0.9
  });

  it("should process path_payment_strict_receive operations", async () => {
    const accountId = "GC7...";

    const mockOperations: any = [
      {
        // Sent path payment (as source)
        type: "path_payment_strict_receive",
        from: accountId,
        to: "GBB...",
        source_amount: "5.0000000",
        source_asset_type: "credit_alphanum4",
        source_asset_code: "USDC",
        amount: "20.0000000",
        asset_type: "native",
        created_at: "2024-01-06T00:00:00Z",
      },
      {
        // Received path payment (as destination)
        type: "path_payment_strict_receive",
        from: "GBB...",
        to: accountId,
        source_amount: "100.0000000",
        source_asset_type: "native",
        amount: "30.0000000",
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        created_at: "2024-01-07T00:00:00Z",
      },
    ];

    const fetchMock = vi.fn((url: string) => {
      if (url.includes("coingecko")) {
        return Promise.resolve({
          json: () =>
            Promise.resolve({
              market_data: { current_price: { eur: 0.1 } }, // XLM to EUR
            }),
        } as Response);
      }
      if (url.includes("frankfurter")) {
        return Promise.resolve({
          json: () => Promise.resolve({ rates: { EUR: 0.9 } }), // USD to EUR
        } as Response);
      }
      return Promise.resolve({
        json: () => Promise.resolve({}),
      } as Response);
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await processTransactions(mockOperations, accountId, {});

    expect(result).toHaveLength(2);

    // Sent path payment assertion
    expect(result[0].TYPE).toBe("path_payment_sent");
    expect(result[0].originalAmount).toBe(5); // 5 USDC sent
    expect(result[0].euroValue).toBe(4.5); // 5 * 0.9

    // Received path payment assertion
    expect(result[1].TYPE).toBe("path_payment_received");
    expect(result[1].originalAmount).toBe(30); // 30 USDC received
    expect(result[1].euroValue).toBe(27); // 30 * 0.9
  });

  it("Handle Blend deposit", async () => {
    const accountId = "GC7...";
    const blendDeposit = {
      transaction_successful: true,
      source_account: accountId,
      type: "invoke_host_function",
      asset_balance_changes: [
        {
          asset_type: "credit_alphanum4",
          asset_code: "EURC",
          asset_issuer: "GDH...",
          type: "transfer",
          from: accountId,
          to: "CAJ...",
          amount: "820.7219053",
        },
      ],
    } as Horizon.ServerApi.OperationRecord;

    const result = await processTransactions([blendDeposit], accountId, {});
    expect(result).toHaveLength(1);
  });

  it("Handle Blend withdraw", async () => {
    const accountId = "GC7...";
    const blendWithdraw = {
      type: "invoke_host_function",
      source_account: accountId,
      created_at: "2024-01-08T00:00:00Z",
      asset_balance_changes: [
        {
          asset_type: "credit_alphanum4",
          asset_code: "EURC",
          asset_issuer: "GDH...",
          type: "transfer",
          from: "CAJ...",
          to: accountId,
          amount: "5.0000000",
        },
      ],
    } as Horizon.ServerApi.OperationRecord;

    const result = await processTransactions([blendWithdraw], accountId, {});
    expect(result).toHaveLength(1);
  });
});
