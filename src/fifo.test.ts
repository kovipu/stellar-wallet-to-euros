import { describe, expect, it } from "vitest";
import { processTransactions } from "./fifo";
import { fail } from "assert";

const myWalletAddress = "GC7...";

describe("processTransactions", () => {
  it("should process a create_account transaction", async () => {
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
      myWalletAddress,
    );

    expect(transactions).toHaveLength(1);
    const tx = transactions[0];

    if (tx.type !== "create_account") {
      fail("Transaction type is not create_account");
    }

    expect(tx.amountStroops).toBe(BigInt("50000000"));
    expect(tx.currency).toBe("XLM");
    expect(tx.date).toStrictEqual(new Date("2024-01-01T00:00:00Z"));
    expect(tx.fromAddress).toBe("GBX...");
    expect(tx.toAddress).toBe(myWalletAddress);
  });

  it("should process a mix of create_account and payment operations", async () => {
    const mockOperations: any = [
      {
        type: "create_account",
        starting_balance: "1000.0000000",
        created_at: "2024-01-01T00:00:00Z",
        funder: "GBX...",
      },
      {
        type: "payment",
        from: myWalletAddress,
        to: "GAZ...",
        amount: "100.0000000",
        asset_type: "native",
        created_at: "2024-01-02T00:00:00Z",
      },
      {
        type: "payment",
        from: "GAZ...",
        to: myWalletAddress,
        amount: "50.0000000",
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        created_at: "2024-01-03T00:00:00Z",
      },
    ];
    const { transactions } = await processTransactions(
      mockOperations,
      myWalletAddress,
    );

    expect(transactions).toHaveLength(3);

    // create_account
    const createAccountTx = transactions[0];
    if (createAccountTx.type !== "create_account") {
      fail("Transaction type is not create_account");
    }
    expect(createAccountTx.amountStroops).toBe(BigInt("10000000000"));
    expect(createAccountTx.currency).toBe("XLM");
    expect(createAccountTx.date).toStrictEqual(new Date("2024-01-01T00:00:00Z"));
    expect(createAccountTx.fromAddress).toBe("GBX...");
    expect(createAccountTx.toAddress).toBe(myWalletAddress);

    // sent payment
    const paymentSentTx = transactions[1];
    if (paymentSentTx.type !== "payment_sent") {
      fail("Transaction type is not payment_sent");
    }
    expect(paymentSentTx.amountStroops).toBe(BigInt("1000000000"));
    expect(paymentSentTx.currency).toBe("XLM");
    expect(paymentSentTx.date).toStrictEqual(new Date("2024-01-02T00:00:00Z"));
    expect(paymentSentTx.fromAddress).toBe(myWalletAddress);
    expect(paymentSentTx.toAddress).toBe("GAZ...");

    // received payment
    const paymentReceivedTx = transactions[2];
    if (paymentReceivedTx.type !== "payment_received") {
      fail("Transaction type is not payment_received");
    }
    expect(paymentReceivedTx.amountStroops).toBe(BigInt("500000000"));
    expect(paymentReceivedTx.currency).toBe("USDC");
    expect(paymentReceivedTx.date).toStrictEqual(new Date("2024-01-03T00:00:00Z"));
    expect(paymentReceivedTx.fromAddress).toBe("GAZ...");
    expect(paymentReceivedTx.toAddress).toBe(myWalletAddress);
  });

  it("should process a swap transaction", async () => {
    const mockOperations: any = [
      {
        type: "path_payment_strict_send",
        created_at: "2025-04-05T08:31:53Z",
        transaction_hash:
          "910ee1edeb8965cae07e31008575ffa33050dc8c109d3ff54db6f9907551b3d7",
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer:
          "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        from: myWalletAddress,
        to: myWalletAddress,
        amount: "37702.4250015",
        path: [],
        source_amount: "147939.5651000",
        destination_min: "37569.3647033",
        source_asset_type: "native",
      },
    ];
    const { transactions } = await processTransactions(
      mockOperations,
      myWalletAddress,
    );

    expect(transactions).toHaveLength(1);

    const tx = transactions[0];
    if (tx.type !== "swap") {
      fail("Transaction type is not swap");
    }
    expect(tx.sourceAmountStroops).toBe(BigInt("1479395651000"));
    expect(tx.sourceCurrency).toBe("XLM");
    expect(tx.destinationAmountStroops).toBe(BigInt("375693647033"));
    expect(tx.destinationCurrency).toBe("USDC");
    expect(tx.date).toStrictEqual(new Date("2025-04-05T08:31:53Z"));
  });
});
