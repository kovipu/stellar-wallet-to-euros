import { describe, expect, it } from "vitest";
import { processTransactions } from "./fifo";
import { fail } from "assert";
import { Horizon } from "@stellar/stellar-sdk";

const myWalletAddress = "GC7...";

const buildCreateAccountTransaction = (
  startingBalance: string,
): Horizon.ServerApi.OperationRecord => {
  return {
    type: "create_account",
    starting_balance: startingBalance,
    created_at: "2024-01-01T00:00:00Z",
    funder: "GBX...",
    transaction: () =>
      Promise.resolve({ fee_charged: "100", fee_account: "GBX..." }),
  } as Horizon.ServerApi.OperationRecord;
};

describe("processTransactions", () => {
  it("should process a create_account transaction", async () => {
    const { transactions, balances } = await processTransactions(
      [buildCreateAccountTransaction("5.0000000")],
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

    expect(balances.XLM).toBe(BigInt("50000000"));
    expect(balances.USDC).toBe(0n);
    expect(balances.EURC).toBe(0n);
  });

  it("should process a mix of create_account and payment operations", async () => {
    const mockOperations = [
      buildCreateAccountTransaction("1000.0000000"),
      {
        type: "payment",
        from: myWalletAddress,
        to: "GAZ...",
        amount: "100.0000000",
        asset_type: "native",
        created_at: "2024-01-02T00:00:00Z",
        transaction: () =>
          Promise.resolve({ fee_charged: "100", fee_account: myWalletAddress }),
      } as Horizon.ServerApi.OperationRecord,
      {
        type: "payment",
        from: "GAZ...",
        to: myWalletAddress,
        amount: "50.0000000",
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        created_at: "2024-01-03T00:00:00Z",
        transaction: () =>
          Promise.resolve({ fee_charged: "100", fee_account: "GAZ..." }),
      } as unknown as Horizon.ServerApi.OperationRecord,
    ];

    const { transactions, balances } = await processTransactions(
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

    expect(balances.XLM).toBe(8999999900n);
    expect(balances.USDC).toBe(500000000n);
    expect(balances.EURC).toBe(0n);
  });

  it("should process a swap transaction", async () => {
    const mockOperations = [
      buildCreateAccountTransaction("150000.0000000"),
      {
        type: "path_payment_strict_send",
        created_at: "2025-04-05T08:31:53Z",
        transaction_hash: "910...",
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: "GA5...",
        from: myWalletAddress,
        to: myWalletAddress,
        amount: "37702.4250015",
        path: [],
        source_amount: "147939.5651000",
        destination_min: "37569.3647033",
        source_asset_type: "native",
        transaction: () =>
          Promise.resolve({
            fee_charged: "1000",
            fee_account: myWalletAddress,
          }),
      } as unknown as Horizon.ServerApi.OperationRecord,
    ];
    const { transactions, balances } = await processTransactions(
      mockOperations,
      myWalletAddress,
    );

    expect(transactions).toHaveLength(2);

    // ignore the create_account transaction and check the swap transaction
    const tx = transactions[1];
    if (tx.type !== "swap") {
      fail("Transaction type is not swap");
    }
    expect(tx.sourceAmountStroops).toBe(1479395651000n);
    expect(tx.sourceCurrency).toBe("XLM");
    expect(tx.destinationAmountStroops).toBe(377024250015n);
    expect(tx.destinationCurrency).toBe("USDC");
    expect(tx.date).toStrictEqual(new Date("2025-04-05T08:31:53Z"));

    expect(balances.XLM).toBe(20604348000n);
    expect(balances.USDC).toBe(377024250015n);
    expect(balances.EURC).toBe(0n);
  });

  it("should process swap_fee transaction", async () => {
    const mockOperations = [
      buildCreateAccountTransaction("100.0000000"),
      {
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
        source_asset_type: "native",
        source_asset_issuer: "GDH...",
        transaction: () =>
          Promise.resolve({
            fee_charged: "1000",
            fee_account: myWalletAddress,
          }),
      } as unknown as Horizon.ServerApi.OperationRecord,
    ];

    const { transactions, balances } = await processTransactions(
      mockOperations,
      myWalletAddress,
    );

    expect(transactions).toHaveLength(2);

    const tx = transactions[1];
    if (tx.type !== "swap_fee") {
      fail("Transaction type is not swap_fee");
    }
    expect(tx.amountStroops).toBe(101149n);
    expect(tx.currency).toBe("XLM");
    expect(tx.date).toStrictEqual(new Date("2025-06-29T17:47:39Z"));
    expect(tx.fromAddress).toBe(myWalletAddress);
    expect(tx.toAddress).toBe("GAB...");

    expect(balances.XLM).toBe(999897851n);
    expect(balances.USDC).toBe(0n);
    expect(balances.EURC).toBe(0n);
  });

  it("should handle Blend deposit", async () => {
    const mockOperations = [
      buildCreateAccountTransaction("1000.0000000"),
      {
        transaction_successful: true,
        source_account: myWalletAddress,
        type: "invoke_host_function",
        created_at: "2024-01-09T00:00:00Z",
        asset_balance_changes: [
          {
            asset_type: "native",
            asset_issuer: "GDH...",
            type: "transfer",
            from: myWalletAddress,
            to: "CAJ...",
            amount: "820.7219053",
          },
        ],
        transaction: () =>
          Promise.resolve({
            fee_charged: "123000",
            fee_account: myWalletAddress,
          }),
      } as Horizon.ServerApi.OperationRecord,
    ];

    const { transactions, balances } = await processTransactions(
      mockOperations,
      myWalletAddress,
    );
    expect(transactions).toHaveLength(2);
    const tx = transactions[1];
    if (tx.type !== "blend_deposit") {
      fail("Transaction type is not blend_deposit");
    }
    expect(tx.amountStroops).toBe(8207219053n);
    expect(tx.currency).toBe("XLM");
    expect(tx.date).toStrictEqual(new Date("2024-01-09T00:00:00Z"));
    expect(tx.fromAddress).toBe(myWalletAddress);
    expect(tx.toAddress).toBe("CAJ...");

    expect(balances.XLM).toBe(1792657947n);
    expect(balances.USDC).toBe(0n);
    expect(balances.EURC).toBe(0n);
  });

  it("should handle Blend withdraw", async () => {
    const mockOperations = [
      buildCreateAccountTransaction("100.0000000"),
      {
        type: "invoke_host_function",
        source_account: myWalletAddress,
        created_at: "2024-01-08T00:00:00Z",
        asset_balance_changes: [
          {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: "GDH...",
            type: "transfer",
            from: "CAJ...",
            to: myWalletAddress,
            amount: "0.0118384",
          },
        ],
        transaction: () =>
          Promise.resolve({
            fee_charged: "123000",
            fee_account: myWalletAddress,
          }),
      } as Horizon.ServerApi.OperationRecord,
    ];

    const { transactions, balances } = await processTransactions(
      mockOperations,
      myWalletAddress,
    );
    expect(transactions).toHaveLength(2);
    const tx = transactions[1];
    if (tx.type !== "blend_withdraw") {
      fail("Transaction type is not blend_withdraw");
    }
    expect(tx.amountStroops).toBe(118384n);
    expect(tx.currency).toBe("USDC");
    expect(tx.date).toStrictEqual(new Date("2024-01-08T00:00:00Z"));
    expect(tx.fromAddress).toBe("CAJ...");
    expect(tx.toAddress).toBe(myWalletAddress);

    expect(balances.XLM).toBe(99999881616n);
    expect(balances.USDC).toBe(118384n);
    expect(balances.EURC).toBe(0n);
  });
});
