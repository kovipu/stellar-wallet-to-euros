import { describe, expect, it } from "vitest";
import { processTransactions } from "./fifo";
import { fail } from "assert";
import { Horizon } from "@stellar/stellar-sdk";

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

    expect(tx.amountStroops).toBe(50000000n);
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
    expect(createAccountTx.amountStroops).toBe(10000000000n);
    expect(createAccountTx.currency).toBe("XLM");
    expect(createAccountTx.date).toStrictEqual(
      new Date("2024-01-01T00:00:00Z"),
    );
    expect(createAccountTx.fromAddress).toBe("GBX...");
    expect(createAccountTx.toAddress).toBe(myWalletAddress);

    // sent payment
    const paymentSentTx = transactions[1];
    if (paymentSentTx.type !== "payment_sent") {
      fail("Transaction type is not payment_sent");
    }
    expect(paymentSentTx.amountStroops).toBe(1000000000n);
    expect(paymentSentTx.currency).toBe("XLM");
    expect(paymentSentTx.date).toStrictEqual(new Date("2024-01-02T00:00:00Z"));
    expect(paymentSentTx.fromAddress).toBe(myWalletAddress);
    expect(paymentSentTx.toAddress).toBe("GAZ...");

    // received payment
    const paymentReceivedTx = transactions[2];
    if (paymentReceivedTx.type !== "payment_received") {
      fail("Transaction type is not payment_received");
    }
    expect(paymentReceivedTx.amountStroops).toBe(500000000n);
    expect(paymentReceivedTx.currency).toBe("USDC");
    expect(paymentReceivedTx.date).toStrictEqual(
      new Date("2024-01-03T00:00:00Z"),
    );
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
    expect(tx.sourceAmountStroops).toBe(1479395651000n);
    expect(tx.sourceCurrency).toBe("XLM");
    expect(tx.destinationAmountStroops).toBe(375693647033n);
    expect(tx.destinationCurrency).toBe("USDC");
    expect(tx.date).toStrictEqual(new Date("2025-04-05T08:31:53Z"));
  });

  it("should process swap_fee transaction", async () => {
    const swapFee = {
      transaction_successful: true,
      source_account: myWalletAddress,
      type: "path_payment_strict_send",
      created_at: "2025-06-29T17:47:39Z",
      transaction_hash: "38ee...",
      asset_type: "credit_alphanum12",
      asset_code: "yUSDC",
      asset_issuer: "GDG...",
      from: myWalletAddress,
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

    const { transactions } = await processTransactions(
      [swapFee],
      myWalletAddress,
    );

    expect(transactions).toHaveLength(1);

    const tx = transactions[0];
    if (tx.type !== "swap_fee") {
      fail("Transaction type is not swap_fee");
    }
    expect(tx.amountStroops).toBe(118384n);
    expect(tx.currency).toBe("EURC");
    expect(tx.date).toStrictEqual(new Date("2025-06-29T17:47:39Z"));
    expect(tx.fromAddress).toBe(myWalletAddress);
    expect(tx.toAddress).toBe("GAB...");
  });
});
