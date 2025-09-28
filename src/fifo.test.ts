import { describe, expect, it } from "vitest";
import { processTransactions } from "./fifo";
import { fail } from "assert";
import { Horizon } from "@stellar/stellar-sdk";

const myWalletAddress = "GC7...";

const buildCreateAccountTx = (startingBalance: string) => {
  const tx = {
    hash: "tx1",
    created_at: "2024-01-01T00:00:00Z",
    fee_charged: "100",
    fee_account: "GBX...",
  } as Horizon.ServerApi.TransactionRecord;

  const ops = [
    {
      type: "create_account",
      starting_balance: startingBalance,
      created_at: "2024-01-01T00:00:00Z",
      funder: "GBX...",
    },
  ] as Horizon.ServerApi.OperationRecord[];

  return { tx, ops };
};

describe("processTransactions", () => {
  it("should process a create_account transaction", async () => {
    const txRows = await processTransactions(
      [buildCreateAccountTx("5.0000000")],
      myWalletAddress,
    );

    expect(txRows).toHaveLength(1);
    const txRow = txRows[0];

    expect(txRow.transactionHash).toBe("tx1");
    expect(txRow.date).toStrictEqual(new Date("2024-01-01T00:00:00Z"));
    expect(txRow.feeStroops).toBe(0n); // fee_account is not our wallet
    expect(txRow.ops).toHaveLength(1);

    const op = txRow.ops[0];
    if (op.kind !== "create_account") {
      fail("Operation kind is not create_account");
    }
    expect(op.amountStroops).toBe(BigInt("50000000"));
    expect(op.from).toBe("GBX...");
    expect(op.to).toBe(myWalletAddress);

    expect(txRow.balances.XLM).toBe(BigInt("50000000"));
    expect(txRow.balances.USDC).toBe(0n);
    expect(txRow.balances.EURC).toBe(0n);
  });

  it("should process a mix of create_account and payment operations", async () => {
    const mockTxWithOps = [
      buildCreateAccountTx("1000.0000000"),
      {
        tx: {
          hash: "tx2",
          created_at: "2024-01-02T00:00:00Z",
          fee_charged: "100",
          fee_account: myWalletAddress,
        } as Horizon.ServerApi.TransactionRecord,
        ops: [
          {
            type: "payment",
            from: myWalletAddress,
            to: "GAZ...",
            amount: "100.0000000",
            asset_type: "native",
            created_at: "2024-01-02T00:00:00Z",
          },
        ] as Horizon.ServerApi.OperationRecord[],
      },
      {
        tx: {
          hash: "tx3",
          created_at: "2024-01-03T00:00:00Z",
          fee_charged: "100",
          fee_account: "GAZ...",
        } as Horizon.ServerApi.TransactionRecord,
        ops: [
          {
            type: "payment",
            from: "GAZ...",
            to: myWalletAddress,
            amount: "50.0000000",
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            created_at: "2024-01-03T00:00:00Z",
          },
        ] as Horizon.ServerApi.OperationRecord[],
      },
    ];

    const txRows = await processTransactions(mockTxWithOps, myWalletAddress);

    expect(txRows).toHaveLength(3);

    // create_account
    const createAccountRow = txRows[0];
    expect(createAccountRow.transactionHash).toBe("tx1");
    expect(createAccountRow.ops).toHaveLength(1);
    const createAccountOp = createAccountRow.ops[0];
    if (createAccountOp.kind !== "create_account") {
      fail("Operation kind is not create_account");
    }
    expect(createAccountOp.amountStroops).toBe(BigInt("10000000000"));
    expect(createAccountOp.from).toBe("GBX...");
    expect(createAccountOp.to).toBe(myWalletAddress);

    // sent payment
    const paymentSentRow = txRows[1];
    expect(paymentSentRow.transactionHash).toBe("tx2");
    expect(paymentSentRow.feeStroops).toBe(100n); // we paid the fee
    expect(paymentSentRow.ops).toHaveLength(1);
    const paymentSentOp = paymentSentRow.ops[0];
    if (paymentSentOp.kind !== "payment") {
      fail("Operation kind is not payment");
    }
    expect(paymentSentOp.direction).toBe("out");
    expect(paymentSentOp.amountStroops).toBe(1000000000n);
    expect(paymentSentOp.currency).toBe("XLM");
    expect(paymentSentOp.from).toBe(myWalletAddress);
    expect(paymentSentOp.to).toBe("GAZ...");

    // received payment
    const paymentReceivedRow = txRows[2];
    expect(paymentReceivedRow.transactionHash).toBe("tx3");
    expect(paymentReceivedRow.feeStroops).toBe(0n); // we didn't pay the fee
    expect(paymentReceivedRow.ops).toHaveLength(1);
    const paymentReceivedOp = paymentReceivedRow.ops[0];
    if (paymentReceivedOp.kind !== "payment") {
      fail("Operation kind is not payment");
    }
    expect(paymentReceivedOp.direction).toBe("in");
    expect(paymentReceivedOp.amountStroops).toBe(500000000n);
    expect(paymentReceivedOp.currency).toBe("USDC");
    expect(paymentReceivedOp.from).toBe("GAZ...");
    expect(paymentReceivedOp.to).toBe(myWalletAddress);

    expect(txRows[2].balances.XLM).toBe(8999999900n);
    expect(txRows[2].balances.USDC).toBe(500000000n);
    expect(txRows[2].balances.EURC).toBe(0n);
  });

  it("should process a swap transaction", async () => {
    const mockTxWithOps = [
      buildCreateAccountTx("150000.0000000"),
      {
        tx: {
          hash: "tx2",
          created_at: "2025-04-05T08:31:53Z",
          fee_charged: "1000",
          fee_account: myWalletAddress,
        } as Horizon.ServerApi.TransactionRecord,
        ops: [
          {
            type: "path_payment_strict_send",
            created_at: "2025-04-05T08:31:53Z",
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
          },
        ] as unknown as Horizon.ServerApi.OperationRecord[],
      },
    ];
    const txRows = await processTransactions(mockTxWithOps, myWalletAddress);

    expect(txRows).toHaveLength(2);

    // ignore the create_account transaction and check the swap transaction
    const swapRow = txRows[1];
    expect(swapRow.transactionHash).toBe("tx2");
    expect(swapRow.feeStroops).toBe(1000n); // we paid the fee
    expect(swapRow.ops).toHaveLength(1);
    const swapOp = swapRow.ops[0];
    if (swapOp.kind !== "swap") {
      fail("Operation kind is not swap");
    }
    expect(swapOp.sourceAmountStroops).toBe(1479395651000n);
    expect(swapOp.sourceCurrency).toBe("XLM");
    expect(swapOp.destinationAmountStroops).toBe(377024250015n);
    expect(swapOp.destinationCurrency).toBe("USDC");

    expect(swapRow.balances.XLM).toBe(20604348000n);
    expect(swapRow.balances.USDC).toBe(377024250015n);
    expect(swapRow.balances.EURC).toBe(0n);
  });

  it("should process swap_fee transaction", async () => {
    const mockTxWithOps = [
      buildCreateAccountTx("100.0000000"),
      {
        tx: {
          hash: "tx2",
          created_at: "2025-06-29T17:47:39Z",
          fee_charged: "1000",
          fee_account: myWalletAddress,
        } as Horizon.ServerApi.TransactionRecord,
        ops: [
          {
            transaction_successful: true,
            source_account: myWalletAddress,
            type: "path_payment_strict_send",
            created_at: "2025-06-29T17:47:39Z",
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
          },
        ] as Horizon.ServerApi.OperationRecord[],
      },
    ];

    const txRows = await processTransactions(mockTxWithOps, myWalletAddress);

    expect(txRows).toHaveLength(2);

    const swapFeeRow = txRows[1];
    expect(swapFeeRow.transactionHash).toBe("tx2");
    expect(swapFeeRow.feeStroops).toBe(1000n); // we paid the fee
    expect(swapFeeRow.ops).toHaveLength(1);
    const swapFeeOp = swapFeeRow.ops[0];
    if (swapFeeOp.kind !== "payment") {
      fail("Operation kind is not payment");
    }
    expect(swapFeeOp.direction).toBe("out");
    expect(swapFeeOp.amountStroops).toBe(101149n);
    expect(swapFeeOp.currency).toBe("XLM");
    expect(swapFeeOp.from).toBe(myWalletAddress);
    expect(swapFeeOp.to).toBe("GAB...");

    expect(swapFeeRow.balances.XLM).toBe(999897851n);
    expect(swapFeeRow.balances.USDC).toBe(0n);
    expect(swapFeeRow.balances.EURC).toBe(0n);
  });

  it("should handle Blend deposit", async () => {
    const mockTxWithOps = [
      buildCreateAccountTx("1000.0000000"),
      {
        tx: {
          hash: "tx2",
          created_at: "2024-01-09T00:00:00Z",
          fee_charged: "123000",
          fee_account: myWalletAddress,
        } as Horizon.ServerApi.TransactionRecord,
        ops: [
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
          },
        ] as Horizon.ServerApi.OperationRecord[],
      },
    ];

    const txRows = await processTransactions(mockTxWithOps, myWalletAddress);
    expect(txRows).toHaveLength(2);
    const blendDepositRow = txRows[1];
    expect(blendDepositRow.transactionHash).toBe("tx2");
    expect(blendDepositRow.feeStroops).toBe(123000n); // we paid the fee
    expect(blendDepositRow.ops).toHaveLength(1);
    const blendDepositOp = blendDepositRow.ops[0];
    if (blendDepositOp.kind !== "blend_deposit") {
      fail("Operation kind is not blend_deposit");
    }
    expect(blendDepositOp.amountStroops).toBe(8207219053n);
    expect(blendDepositOp.currency).toBe("XLM");
    expect(blendDepositOp.from).toBe(myWalletAddress);
    expect(blendDepositOp.to).toBe("CAJ...");

    expect(blendDepositRow.balances.XLM).toBe(1792657947n);
    expect(blendDepositRow.balances.USDC).toBe(0n);
    expect(blendDepositRow.balances.EURC).toBe(0n);
  });

  it("should handle Blend withdraw", async () => {
    const mockTxWithOps = [
      buildCreateAccountTx("100.0000000"),
      {
        tx: {
          hash: "tx2",
          created_at: "2024-01-08T00:00:00Z",
          fee_charged: "123000",
          fee_account: myWalletAddress,
        } as Horizon.ServerApi.TransactionRecord,
        ops: [
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
          },
        ] as Horizon.ServerApi.OperationRecord[],
      },
    ];

    const txRows = await processTransactions(mockTxWithOps, myWalletAddress);
    expect(txRows).toHaveLength(2);
    const blendWithdrawRow = txRows[1];
    expect(blendWithdrawRow.transactionHash).toBe("tx2");
    expect(blendWithdrawRow.feeStroops).toBe(123000n); // we paid the fee
    expect(blendWithdrawRow.ops).toHaveLength(1);
    const blendWithdrawOp = blendWithdrawRow.ops[0];
    if (blendWithdrawOp.kind !== "blend_withdraw") {
      fail("Operation kind is not blend_withdraw");
    }
    expect(blendWithdrawOp.amountStroops).toBe(118384n);
    expect(blendWithdrawOp.currency).toBe("USDC");
    expect(blendWithdrawOp.from).toBe("CAJ...");
    expect(blendWithdrawOp.to).toBe(myWalletAddress);

    expect(blendWithdrawRow.balances.XLM).toBe(999877000n);
    expect(blendWithdrawRow.balances.USDC).toBe(118384n);
    expect(blendWithdrawRow.balances.EURC).toBe(0n);
  });

  it("should handle multiple operations in a single transaction", async () => {
    const mockTxWithOps = [
      buildCreateAccountTx("100.0000000"),
      {
        tx: {
          hash: "tx2",
          created_at: "2024-01-07T00:00:00Z",
          fee_charged: "123000",
          fee_account: myWalletAddress,
        } as Horizon.ServerApi.TransactionRecord,
        ops: [
          {
            type: "path_payment_strict_receive",
            source_account: myWalletAddress,
            created_at: "2024-01-07T00:00:00Z",
            source_asset_type: "native",
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            from: myWalletAddress,
            to: myWalletAddress,
            source_amount: "90.0000000",
            amount: "41.0000000",
          },
          {
            type: "path_payment_strict_send",
            source_account: myWalletAddress,
            created_at: "2024-01-07T00:00:00Z",
            source_asset_type: "credit_alphanum4",
            source_asset_code: "USDC",
            asset_issuer: "GDH...",
            from: myWalletAddress,
            to: "GBB...",
            source_amount: "0.0118384",
          },
        ] as Horizon.ServerApi.OperationRecord[],
      },
    ];

    const txRows = await processTransactions(mockTxWithOps, myWalletAddress);
    expect(txRows).toHaveLength(2);
    const swapRow = txRows[1];
    expect(swapRow.transactionHash).toBe("tx2");
    expect(swapRow.feeStroops).toBe(123000n); // we paid the fee
    expect(swapRow.ops).toHaveLength(2);
    expect(swapRow.ops[0].kind).toBe("swap");
    expect(swapRow.ops[1].kind).toBe("payment");

    expect(swapRow.balances.XLM).toBe(99877000n);
    expect(swapRow.balances.USDC).toBe(409881616n);
    expect(swapRow.balances.EURC).toBe(0n);
  });
});
