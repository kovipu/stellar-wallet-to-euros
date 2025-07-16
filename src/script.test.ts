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
    expect(result[0].transactionType).toBe("create_account");
    expect(result[0].amount).toBe("1000.0000000");
    expect(parseFloat(result[0].euroValue.replace(",", "."))).toBeCloseTo(100);

    // sent payment
    expect(result[1].transactionType).toBe("payment_sent");
    expect(result[1].amount).toBe("100.0000000");
    expect(parseFloat(result[1].euroValue.replace(",", "."))).toBeCloseTo(10);

    // received payment
    expect(result[2].transactionType).toBe("payment_received");
    expect(result[2].amount).toBe("50.0000000");
    expect(parseFloat(result[2].euroValue.replace(",", "."))).toBeCloseTo(45);
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
    expect(result[0].transactionType).toBe("path_payment_sent");
    expect(result[0].amount).toBe("10.0000000"); // 10 USDC sent
    expect(parseFloat(result[0].euroValue.replace(",", "."))).toBeCloseTo(9); // 10 * 0.9

    // Received path payment assertion
    expect(result[1].transactionType).toBe("path_payment_received");
    expect(result[1].amount).toBe("20.0000000"); // 20 USDC received
    expect(parseFloat(result[1].euroValue.replace(",", "."))).toBeCloseTo(18); // 20 * 0.9
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

    const result = await processTransactions(mockOperations, accountId, {});

    expect(result).toHaveLength(2);

    // Sent path payment assertion
    expect(result[0].transactionType).toBe("path_payment_sent");
    expect(result[0].amount).toBe("5.0000000"); // 5 USDC sent
    expect(parseFloat(result[0].euroValue.replace(",", "."))).toBeCloseTo(4.5); // 5 * 0.9

    // Received path payment assertion
    expect(result[1].transactionType).toBe("path_payment_received");
    expect(result[1].amount).toBe("30.0000000"); // 30 USDC received
    expect(parseFloat(result[1].euroValue.replace(",", "."))).toBeCloseTo(27); // 30 * 0.9
  });

  it("Handle Blend deposit", async () => {
    const accountId = "GC7...";
    const blendDeposit = {
      transaction_successful: true,
      source_account: accountId,
      type: "invoke_host_function",
      created_at: "2024-01-09T00:00:00Z",
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
    const tx = result[0];
    expect(tx.transactionType).toBe("blend_deposit");
    expect(tx.toAddress).toBe("CAJ...");
    expect(tx.amount).toBe("820.7219053");
    expect(tx.currency).toBe("EURC");
    expect(parseFloat(tx.euroValue.replace(",", "."))).toBeCloseTo(820.7219053);
    expect(tx.timestamp).toBe("2024-01-09T00:00:00Z");
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
    const tx = result[0];
    expect(tx.transactionType).toBe("blend_withdraw");
    expect(tx.toAddress).toBe(accountId);
    expect(tx.amount).toBe("5.0000000");
    expect(tx.currency).toBe("EURC");
    expect(parseFloat(tx.euroValue.replace(",", "."))).toBeCloseTo(5.0);
    expect(tx.timestamp).toBe("2024-01-08T00:00:00Z");
  });

  it("Handle swap with a path", async () => {
    const accountId = "GC7...";
    const swap = {
      transaction_successful: true,
      source_account: accountId,
      type: "path_payment_strict_send",
      created_at: "2025-06-29T17:47:39Z",
      transaction_hash: "38ee...",
      asset_type: "credit_alphanum12",
      asset_code: "yUSDC",
      asset_issuer: "GDG...",
      from: accountId,
      to: "GAB...",
      amount: "0.0118384",
      path: [
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: "GA5...",
        },
      ],
      source_amount: "0.0101149",
      destination_min: "0.0000001",
      source_asset_type: "credit_alphanum4",
      source_asset_code: "EURC",
      source_asset_issuer: "GDH...",
    } as Horizon.ServerApi.OperationRecord;

    const result = await processTransactions([swap], accountId, {});
    expect(result).toHaveLength(1);
    const tx = result[0];
    expect(tx.transactionType).toBe("swap");
    expect(tx.fromAddress).toBe(accountId);
    expect(tx.toAddress).toBe("GAB...");
    expect(tx.amount).toBe("0.0118384");
    expect(tx.currency).toBe("USDC");
  });
});
