import { describe, expect, it } from "vitest";
import { processTransactions } from "./fifo";

describe("processTransactions", () => {
  it("should process a create_account transaction", async () => {
    const accountId = "GC7...";

    const mockOperations: any = [
      {
        type: "create_account",
        starting_balance: "5.0000000",
        created_at: "2024-01-01T00:00:00Z",
        funder: "GBX...",
      },
    ];
    const { transactions } = await processTransactions(
      mockOperations,
      accountId,
    );

    expect(transactions).toHaveLength(1);
    expect(transactions[0].type).toBe("create_account");
    expect(transactions[0].amountStroops).toBe(50_000_000n);
    expect(transactions[0].currency).toBe("XLM");
    expect(transactions[0].date).toStrictEqual(
      new Date("2024-01-01T00:00:00Z"),
    );
    expect(transactions[0].fromAddress).toBe("GBX...");
    expect(transactions[0].toAddress).toBe(accountId);
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
    const { transactions } = await processTransactions(
      mockOperations,
      accountId,
      {},
    );

    expect(transactions).toHaveLength(3);

    // create_account
    expect(transactions[0].type).toBe("create_account");
    expect(transactions[0].amountStroops).toBe(1000_0000000n);
    expect(transactions[0].currency).toBe("XLM");
    expect(transactions[0].date).toStrictEqual(
      new Date("2024-01-01T00:00:00Z"),
    );
    expect(transactions[0].fromAddress).toBe("GBX...");
    expect(transactions[0].toAddress).toBe(accountId);

    // sent payment
    expect(transactions[1].type).toBe("payment_sent");
    expect(transactions[1].amountStroops).toBe(100_0000000n);
    expect(transactions[1].currency).toBe("XLM");
    expect(transactions[1].date).toStrictEqual(
      new Date("2024-01-02T00:00:00Z"),
    );
    expect(transactions[1].fromAddress).toBe(accountId);
    expect(transactions[1].toAddress).toBe("GAZ...");

    // received payment
    expect(transactions[2].type).toBe("payment_received");
    expect(transactions[2].amountStroops).toBe(50_0000000n);
    expect(transactions[2].currency).toBe("USDC");
    expect(transactions[2].date).toStrictEqual(
      new Date("2024-01-03T00:00:00Z"),
    );
    expect(transactions[2].fromAddress).toBe("GAZ...");
    expect(transactions[2].toAddress).toBe(accountId);
  });
});
