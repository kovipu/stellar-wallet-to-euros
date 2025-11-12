import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Horizon } from "@stellar/stellar-sdk";

// Use vi.hoisted to ensure the mock is created before the module mock
const mockHorizonServer = vi.hoisted(() => ({
  transactions: vi.fn().mockReturnThis(),
  operations: vi.fn().mockReturnThis(),
  trades: vi.fn().mockReturnThis(),
  forAccount: vi.fn().mockReturnThis(),
  forOffer: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  call: vi.fn(),
}));

// Mock at the module level before importing
vi.mock("@stellar/stellar-sdk", () => {
  return {
    Horizon: {
      Server: vi.fn(() => mockHorizonServer),
    },
  };
});

// Import after mocking
import { fetchTransactionsWithOps } from "./horizon";

describe("horizon.ts", () => {
  const testWallet = "GC7...";
  const mockServer = mockHorizonServer;

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Reset mockReturnThis chain
    mockServer.transactions.mockReturnThis();
    mockServer.operations.mockReturnThis();
    mockServer.trades.mockReturnThis();
    mockServer.forAccount.mockReturnThis();
    mockServer.forOffer.mockReturnThis();
    mockServer.limit.mockReturnThis();
    mockServer.order.mockReturnThis();

    // Mock console.log to avoid noise in test output
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("fetchTransactionsWithOps - Grouping Logic", () => {
    it("should correctly group operations by transaction hash", async () => {
      const mockTx1 = {
        hash: "tx1",
        created_at: "2025-01-01T00:00:00Z",
      } as Horizon.ServerApi.TransactionRecord;

      const mockTx2 = {
        hash: "tx2",
        created_at: "2025-01-02T00:00:00Z",
      } as Horizon.ServerApi.TransactionRecord;

      const mockOp1 = {
        transaction_hash: "tx1",
        type: "payment",
        source_account: testWallet,
        to: testWallet,
      } as Horizon.ServerApi.OperationRecord;

      const mockOp2 = {
        transaction_hash: "tx1",
        type: "change_trust",
        source_account: testWallet,
      } as Horizon.ServerApi.OperationRecord;

      const mockOp3 = {
        transaction_hash: "tx2",
        type: "payment",
        source_account: testWallet,
        to: testWallet,
      } as Horizon.ServerApi.OperationRecord;

      // Mock transactions page
      mockServer.call.mockResolvedValueOnce({
        records: [mockTx1, mockTx2],
      });

      // Mock operations page
      mockServer.call.mockResolvedValueOnce({
        records: [mockOp1, mockOp2, mockOp3],
      });

      const result = await fetchTransactionsWithOps(testWallet);

      expect(result).toHaveLength(2);
      expect(result[0].tx.hash).toBe("tx1");
      expect(result[0].ops).toHaveLength(2);
      expect(result[0].ops).toContain(mockOp1);
      expect(result[0].ops).toContain(mockOp2);

      expect(result[1].tx.hash).toBe("tx2");
      expect(result[1].ops).toHaveLength(1);
      expect(result[1].ops).toContain(mockOp3);
    });

    it("should throw error for transactions without operations", async () => {
      const txHash = "tx1";
      const mockTx = {
        hash: txHash,
        created_at: "2025-01-01T00:00:00Z",
      } as Horizon.ServerApi.TransactionRecord;

      // Mock transactions page
      mockServer.call.mockResolvedValueOnce({
        records: [mockTx],
      });

      // Mock empty operations page
      mockServer.call.mockResolvedValueOnce({
        records: [],
      });

      // Should throw error when transaction has no operations
      await expect(fetchTransactionsWithOps(testWallet)).rejects.toThrow(
        `Transaction ${txHash} has no operations for this wallet`,
      );
    });
  });

  describe("Pagination Logic", () => {
    it("transactions – should fetch single page when results < 200", async () => {
      const mockTxs = Array.from({ length: 150 }, (_, i) => ({
        hash: `tx${i}`,
        created_at: "2025-01-01T00:00:00Z",
      })) as Horizon.ServerApi.TransactionRecord[];

      const mockOps = Array.from({ length: 150 }, (_, i) => ({
        transaction_hash: `tx${i}`,
        type: "payment",
        source_account: testWallet,
        to: testWallet,
      })) as Horizon.ServerApi.OperationRecord[];

      // Mock transactions page with < 200 records
      mockServer.call.mockResolvedValueOnce({
        records: mockTxs,
        next: vi.fn(),
      });

      // Mock operations page
      mockServer.call.mockResolvedValueOnce({
        records: mockOps,
      });

      const result = await fetchTransactionsWithOps(testWallet);

      expect(result).toHaveLength(150);
      // Verify that next() was not called
      expect(mockServer.call).toHaveBeenCalledTimes(2); // 1 for txs, 1 for ops
    });

    it("transactions – should fetch multiple pages when results = 200", async () => {
      const mockTxsPage1 = Array.from({ length: 200 }, (_, i) => ({
        hash: `tx${i}`,
        created_at: "2025-01-01T00:00:00Z",
      })) as Horizon.ServerApi.TransactionRecord[];

      const mockTxsPage2 = Array.from({ length: 100 }, (_, i) => ({
        hash: `tx${200 + i}`,
        created_at: "2025-01-01T00:00:00Z",
      })) as Horizon.ServerApi.TransactionRecord[];

      // Create one operation per transaction (< 200 to avoid ops pagination)
      const mockOps = Array.from({ length: 300 }, (_, i) => ({
        transaction_hash: `tx${i}`,
        type: "payment",
        source_account: testWallet,
        to: testWallet,
      })) as Horizon.ServerApi.OperationRecord[];

      const mockTxPage2 = {
        records: mockTxsPage2,
        next: vi.fn(),
      };

      const mockTxPage1 = {
        records: mockTxsPage1,
        next: vi.fn().mockResolvedValue(mockTxPage2),
      };

      // Mock transactions pagination
      mockServer.call.mockResolvedValueOnce(mockTxPage1);

      // Mock operations - split into pages to avoid triggering pagination error
      const mockOpsPage2 = {
        records: mockOps.slice(200),
        next: vi.fn(),
      };

      const mockOpsPage1 = {
        records: mockOps.slice(0, 200),
        next: vi.fn().mockResolvedValue(mockOpsPage2),
      };

      mockServer.call.mockResolvedValueOnce(mockOpsPage1);

      const result = await fetchTransactionsWithOps(testWallet);

      expect(result).toHaveLength(300);
      expect(mockTxPage1.next).toHaveBeenCalledTimes(1);
    });

    it("operations – should fetch single page when results < 200", async () => {
      // Mock transactions page
      mockServer.call.mockResolvedValueOnce({
        records: [],
      });

      const mockOps = Array.from({ length: 150 }, (_, i) => ({
        transaction_hash: `tx${i}`,
        type: "payment",
        source_account: testWallet,
        to: testWallet,
      })) as Horizon.ServerApi.OperationRecord[];

      // Mock operations page with < 200 records
      mockServer.call.mockResolvedValueOnce({
        records: mockOps,
        next: vi.fn(),
      });

      await fetchTransactionsWithOps(testWallet);

      // Verify only called twice (once for tx, once for ops)
      expect(mockServer.call).toHaveBeenCalledTimes(2);
    });

    it("operations – should fetch multiple pages when results = 200", async () => {
      // Mock transactions page
      mockServer.call.mockResolvedValueOnce({
        records: [],
      });

      const mockOpsPage1 = Array.from({ length: 200 }, (_, i) => ({
        transaction_hash: `tx${i}`,
        type: "payment",
        source_account: testWallet,
        to: testWallet,
      })) as Horizon.ServerApi.OperationRecord[];

      const mockOpsPage2 = Array.from({ length: 50 }, (_, i) => ({
        transaction_hash: `tx${200 + i}`,
        type: "payment",
        source_account: testWallet,
        to: testWallet,
      })) as Horizon.ServerApi.OperationRecord[];

      const mockPage2 = {
        records: mockOpsPage2,
        next: vi.fn(),
      };

      const mockPage1 = {
        records: mockOpsPage1,
        next: vi.fn().mockResolvedValue(mockPage2),
      };

      // Mock operations pagination
      mockServer.call.mockResolvedValueOnce(mockPage1);

      await fetchTransactionsWithOps(testWallet);

      expect(mockPage1.next).toHaveBeenCalledTimes(1);
    });
  });

  describe("Operation Filtering Logic", () => {
    it("should include payment operations where wallet is sender", async () => {
      const mockTx = {
        hash: "tx1",
        created_at: "2025-01-01T00:00:00Z",
      } as Horizon.ServerApi.TransactionRecord;

      const mockOp = {
        transaction_hash: "tx1",
        type: "payment",
        source_account: testWallet,
        to: "OTHER_WALLET",
      } as Horizon.ServerApi.OperationRecord;

      mockServer.call.mockResolvedValueOnce({
        records: [mockTx],
      });

      mockServer.call.mockResolvedValueOnce({
        records: [mockOp],
      });

      const result = await fetchTransactionsWithOps(testWallet);

      expect(result[0].ops).toHaveLength(1);
      expect(result[0].ops[0]).toBe(mockOp);
    });

    it("should include payment operations where wallet is receiver", async () => {
      const mockTx = {
        hash: "tx1",
        created_at: "2025-01-01T00:00:00Z",
      } as Horizon.ServerApi.TransactionRecord;

      const mockOp = {
        transaction_hash: "tx1",
        type: "payment",
        source_account: "OTHER_WALLET",
        to: testWallet,
      } as Horizon.ServerApi.OperationRecord;

      mockServer.call.mockResolvedValueOnce({
        records: [mockTx],
      });

      mockServer.call.mockResolvedValueOnce({
        records: [mockOp],
      });

      const result = await fetchTransactionsWithOps(testWallet);

      expect(result[0].ops).toHaveLength(1);
      expect(result[0].ops[0]).toBe(mockOp);
    });

    it("should throw error for transactions with only dusting attacks", async () => {
      const txHash = "tx1";
      const mockTx = {
        hash: txHash,
        created_at: "2025-01-01T00:00:00Z",
      } as Horizon.ServerApi.TransactionRecord;

      const mockDustingOp = {
        transaction_hash: txHash,
        type: "payment",
        source_account: "OTHER_WALLET_1",
        to: "OTHER_WALLET_2",
      } as Horizon.ServerApi.OperationRecord;

      mockServer.call.mockResolvedValueOnce({
        records: [mockTx],
      });

      mockServer.call.mockResolvedValueOnce({
        records: [mockDustingOp],
      });

      // Should throw error when all operations are filtered out (dusting attacks)
      await expect(fetchTransactionsWithOps(testWallet)).rejects.toThrow(
        `Transaction ${txHash} has no operations for this wallet`,
      );
    });

    it("should include create_claimable_balance where wallet is a claimant", async () => {
      const mockTx = {
        hash: "tx1",
        created_at: "2025-01-01T00:00:00Z",
      } as Horizon.ServerApi.TransactionRecord;

      const mockClaimableOp = {
        transaction_hash: "tx1",
        type: "create_claimable_balance",
        claimants: [
          { destination: "OTHER_WALLET" },
          { destination: testWallet },
        ],
      } as Horizon.ServerApi.OperationRecord;

      // Add another operation so the transaction isn't filtered out
      const mockPaymentOp = {
        transaction_hash: "tx1",
        type: "payment",
        source_account: testWallet,
        to: "OTHER",
      } as Horizon.ServerApi.OperationRecord;

      mockServer.call.mockResolvedValueOnce({
        records: [mockTx],
      });

      mockServer.call.mockResolvedValueOnce({
        records: [mockClaimableOp, mockPaymentOp],
      });

      const result = await fetchTransactionsWithOps(testWallet);

      expect(result).toHaveLength(1);
      expect(result[0].ops).toHaveLength(2);
      expect(result[0].ops).toContain(mockClaimableOp);
      expect(result[0].ops).toContain(mockPaymentOp);
    });

    it("should throw error when create_claimable_balance excludes wallet", async () => {
      const txHash = "tx1";
      const mockTx = {
        hash: txHash,
        created_at: "2025-01-01T00:00:00Z",
      } as Horizon.ServerApi.TransactionRecord;

      const mockOp = {
        transaction_hash: txHash,
        type: "create_claimable_balance",
        claimants: [
          { destination: "OTHER_WALLET_1" },
          { destination: "OTHER_WALLET_2" },
        ],
      } as Horizon.ServerApi.OperationRecord;

      mockServer.call.mockResolvedValueOnce({
        records: [mockTx],
      });

      mockServer.call.mockResolvedValueOnce({
        records: [mockOp],
      });

      // Operation is filtered out during fetchOperations, transaction has no ops
      await expect(fetchTransactionsWithOps(testWallet)).rejects.toThrow(
        `Transaction ${txHash} has no operations for this wallet`,
      );
    });

    it("should include all non-payment, non-claimable operations", async () => {
      const mockTx = {
        hash: "tx1",
        created_at: "2025-01-01T00:00:00Z",
      } as Horizon.ServerApi.TransactionRecord;

      const mockOps = [
        {
          transaction_hash: "tx1",
          type: "change_trust",
          source_account: testWallet,
        },
        {
          transaction_hash: "tx1",
          type: "set_options",
          source_account: testWallet,
        },
        {
          transaction_hash: "tx1",
          type: "invoke_host_function",
          source_account: testWallet,
        },
      ] as Horizon.ServerApi.OperationRecord[];

      mockServer.call.mockResolvedValueOnce({
        records: [mockTx],
      });

      mockServer.call.mockResolvedValueOnce({
        records: mockOps,
      });

      const result = await fetchTransactionsWithOps(testWallet);

      expect(result[0].ops).toHaveLength(3);
    });

    it("should apply filtering on each page before accumulating", async () => {
      const mockTx = {
        hash: "tx1",
        created_at: "2025-01-01T00:00:00Z",
      } as Horizon.ServerApi.TransactionRecord;

      // Page 1: must have 200 records to trigger pagination
      // Include 2 valid ops and 198 dusting attacks
      const mockOpsPage1 = [
        {
          transaction_hash: "tx1",
          type: "payment",
          source_account: testWallet,
          to: "OTHER",
        },
        {
          transaction_hash: "tx1",
          type: "change_trust",
          source_account: testWallet,
        },
        // Add 198 dusting attack operations to reach 200 total
        ...Array.from({ length: 198 }, (_, i) => ({
          transaction_hash: "tx1",
          type: "payment",
          source_account: `DUST_${i}`,
          to: `OTHER_${i}`,
        })),
      ] as Horizon.ServerApi.OperationRecord[];

      // Page 2: 1 valid, 1 invalid (dusting)
      const mockOpsPage2 = [
        {
          transaction_hash: "tx1",
          type: "payment",
          source_account: testWallet,
          to: "OTHER",
        },
        {
          transaction_hash: "tx1",
          type: "payment",
          source_account: "OTHER3",
          to: "OTHER4", // Dusting - should be filtered
        },
      ] as Horizon.ServerApi.OperationRecord[];

      mockServer.call.mockResolvedValueOnce({
        records: [mockTx],
      });

      const mockPage2 = {
        records: mockOpsPage2,
        next: vi.fn(),
      };

      const mockPage1 = {
        records: mockOpsPage1,
        next: vi.fn().mockResolvedValue(mockPage2),
      };

      mockServer.call.mockResolvedValueOnce(mockPage1);

      const result = await fetchTransactionsWithOps(testWallet);

      // Should have 3 operations total (2 from page1 + 1 from page2, dusting filtered)
      expect(result[0].ops).toHaveLength(3);
    });
  });

  describe("Transaction Filtering - create_claimable_balance", () => {
    it("should filter out transactions with ONLY create_claimable_balance operations", async () => {
      const mockTx = {
        hash: "tx_spam",
        created_at: "2025-01-01T00:00:00Z",
      } as Horizon.ServerApi.TransactionRecord;

      const mockOps = [
        {
          transaction_hash: "tx_spam",
          type: "create_claimable_balance",
          claimants: [{ destination: testWallet }],
        },
        {
          transaction_hash: "tx_spam",
          type: "create_claimable_balance",
          claimants: [{ destination: testWallet }],
        },
      ] as Horizon.ServerApi.OperationRecord[];

      mockServer.call.mockResolvedValueOnce({
        records: [mockTx],
      });

      mockServer.call.mockResolvedValueOnce({
        records: mockOps,
      });

      const result = await fetchTransactionsWithOps(testWallet);

      // Transaction should be filtered out completely
      expect(result).toHaveLength(0);
    });

    it("should keep transactions with create_claimable_balance AND other operations", async () => {
      const mockTx = {
        hash: "tx_mixed",
        created_at: "2025-01-01T00:00:00Z",
      } as Horizon.ServerApi.TransactionRecord;

      const mockOps = [
        {
          transaction_hash: "tx_mixed",
          type: "create_claimable_balance",
          claimants: [{ destination: testWallet }],
        },
        {
          transaction_hash: "tx_mixed",
          type: "payment",
          source_account: testWallet,
          to: "OTHER",
        },
      ] as Horizon.ServerApi.OperationRecord[];

      mockServer.call.mockResolvedValueOnce({
        records: [mockTx],
      });

      mockServer.call.mockResolvedValueOnce({
        records: mockOps,
      });

      const result = await fetchTransactionsWithOps(testWallet);

      // Transaction should be kept
      expect(result).toHaveLength(1);
      expect(result[0].ops).toHaveLength(2);
    });

    it("should filter out multiple create_claimable_balance-only transactions", async () => {
      const mockTx1 = {
        hash: "tx_spam1",
        created_at: "2025-01-01T00:00:00Z",
      } as Horizon.ServerApi.TransactionRecord;

      const mockTx2 = {
        hash: "tx_good",
        created_at: "2025-01-02T00:00:00Z",
      } as Horizon.ServerApi.TransactionRecord;

      const mockTx3 = {
        hash: "tx_spam2",
        created_at: "2025-01-03T00:00:00Z",
      } as Horizon.ServerApi.TransactionRecord;

      const mockOps = [
        {
          transaction_hash: "tx_spam1",
          type: "create_claimable_balance",
          claimants: [{ destination: testWallet }],
        },
        {
          transaction_hash: "tx_good",
          type: "payment",
          source_account: testWallet,
          to: "OTHER",
        },
        {
          transaction_hash: "tx_spam2",
          type: "create_claimable_balance",
          claimants: [{ destination: testWallet }],
        },
      ] as Horizon.ServerApi.OperationRecord[];

      mockServer.call.mockResolvedValueOnce({
        records: [mockTx1, mockTx2, mockTx3],
      });

      mockServer.call.mockResolvedValueOnce({
        records: mockOps,
      });

      const result = await fetchTransactionsWithOps(testWallet);

      // Only tx_good should remain
      expect(result).toHaveLength(1);
      expect(result[0].tx.hash).toBe("tx_good");
    });
  });

  describe("Trade Fetching for manage_sell_offer", () => {
    it("should fetch trades for transactions in offerIdByTxHash", async () => {
      const txHashWithTrades =
        "448e8f032d02fe7d018d5f09761b5bac03bcace1b2c55277d91bd20be160744b";
      const offerId = "1799912560";

      const mockTx = {
        hash: txHashWithTrades,
        created_at: "2025-01-01T00:00:00Z",
      } as Horizon.ServerApi.TransactionRecord;

      const mockOp = {
        transaction_hash: txHashWithTrades,
        type: "manage_sell_offer",
        source_account: testWallet,
      } as Horizon.ServerApi.OperationRecord;

      const mockTrades = [
        {
          trade_type: "orderbook",
          base_account: testWallet,
          base_offer_id: offerId,
          base_amount: "100.0000000",
          counter_amount: "200.0000000",
        },
        {
          trade_type: "orderbook",
          base_account: testWallet,
          base_offer_id: offerId,
          base_amount: "50.0000000",
          counter_amount: "100.0000000",
        },
      ] as Horizon.ServerApi.TradeRecord[];

      // Mock transactions
      mockServer.call.mockResolvedValueOnce({
        records: [mockTx],
      });

      // Mock operations
      mockServer.call.mockResolvedValueOnce({
        records: [mockOp],
      });

      // Mock trades for the offer
      mockServer.call.mockResolvedValueOnce({
        records: mockTrades,
      });

      const result = await fetchTransactionsWithOps(testWallet);

      expect(result).toHaveLength(1);
      expect(result[0].trades).toBeDefined();
      expect(result[0].trades).toHaveLength(2);
      expect(result[0].trades![0].base_amount).toBe("100.0000000");

      // Verify fetchTradesForOffer was called with correct parameters
      expect(mockServer.trades).toHaveBeenCalled();
      expect(mockServer.forOffer).toHaveBeenCalledWith(offerId);
    });

    it("should not fetch trades for non-manage_sell_offer transactions", async () => {
      const mockTx = {
        hash: "some_random_tx_hash",
        created_at: "2025-01-01T00:00:00Z",
      } as Horizon.ServerApi.TransactionRecord;

      const mockOp = {
        transaction_hash: "some_random_tx_hash",
        type: "payment",
        source_account: testWallet,
        to: testWallet,
      } as Horizon.ServerApi.OperationRecord;

      // Mock transactions
      mockServer.call.mockResolvedValueOnce({
        records: [mockTx],
      });

      // Mock operations
      mockServer.call.mockResolvedValueOnce({
        records: [mockOp],
      });

      const result = await fetchTransactionsWithOps(testWallet);

      expect(result).toHaveLength(1);
      expect(result[0].trades).toBeUndefined();

      // Verify fetchTradesForOffer was NOT called
      expect(mockServer.trades).not.toHaveBeenCalled();
      expect(mockServer.forOffer).not.toHaveBeenCalled();
    });

    it("should throw error for manage_sell_offer tx NOT in offerIdByTxHash", async () => {
      const txHash = "some_random_tx_hash";
      const mockTx = {
        hash: txHash,
        created_at: "2025-01-01T00:00:00Z",
      } as Horizon.ServerApi.TransactionRecord;

      const mockOp = {
        transaction_hash: txHash,
        type: "manage_sell_offer",
        source_account: testWallet,
      } as Horizon.ServerApi.OperationRecord;

      // Mock transactions
      mockServer.call.mockResolvedValueOnce({
        records: [mockTx],
      });

      // Mock operations
      mockServer.call.mockResolvedValueOnce({
        records: [mockOp],
      });

      // Should throw error when manage_sell_offer tx is not in lookup table
      await expect(fetchTransactionsWithOps(testWallet)).rejects.toThrow(
        `No offerId found for tx: ${txHash}`,
      );

      // Verify fetchTradesForOffer was NOT called
      expect(mockServer.trades).not.toHaveBeenCalled();
      expect(mockServer.forOffer).not.toHaveBeenCalled();
    });

    it("should attach trades to correct transaction when multiple txs exist", async () => {
      const txHashWithTrades =
        "448e8f032d02fe7d018d5f09761b5bac03bcace1b2c55277d91bd20be160744b";
      const txHashWithoutTrades = "other_tx_hash";
      const offerId = "1799912560";

      const mockTx1 = {
        hash: txHashWithTrades,
        created_at: "2025-01-01T00:00:00Z",
      } as Horizon.ServerApi.TransactionRecord;

      const mockTx2 = {
        hash: txHashWithoutTrades,
        created_at: "2025-01-02T00:00:00Z",
      } as Horizon.ServerApi.TransactionRecord;

      const mockOp1 = {
        transaction_hash: txHashWithTrades,
        type: "manage_sell_offer",
        source_account: testWallet,
      } as Horizon.ServerApi.OperationRecord;

      const mockOp2 = {
        transaction_hash: txHashWithoutTrades,
        type: "payment",
        source_account: testWallet,
        to: testWallet,
      } as Horizon.ServerApi.OperationRecord;

      const mockTrades = [
        {
          trade_type: "orderbook",
          base_account: testWallet,
          base_offer_id: offerId,
          base_amount: "100.0000000",
          counter_amount: "200.0000000",
        },
      ] as Horizon.ServerApi.TradeRecord[];

      // Mock transactions
      mockServer.call.mockResolvedValueOnce({
        records: [mockTx1, mockTx2],
      });

      // Mock operations
      mockServer.call.mockResolvedValueOnce({
        records: [mockOp1, mockOp2],
      });

      // Mock trades
      mockServer.call.mockResolvedValueOnce({
        records: mockTrades,
      });

      const result = await fetchTransactionsWithOps(testWallet);

      expect(result).toHaveLength(2);

      // First transaction should have trades
      const txWithTrades = result.find((r) => r.tx.hash === txHashWithTrades);
      expect(txWithTrades?.trades).toBeDefined();
      expect(txWithTrades?.trades).toHaveLength(1);

      // Second transaction should NOT have trades
      const txWithoutTrades = result.find(
        (r) => r.tx.hash === txHashWithoutTrades,
      );
      expect(txWithoutTrades?.trades).toBeUndefined();
    });

    it("should fetch trades with pagination", async () => {
      const txHashWithTrades =
        "448e8f032d02fe7d018d5f09761b5bac03bcace1b2c55277d91bd20be160744b";
      const offerId = "1799912560";

      const mockTx = {
        hash: txHashWithTrades,
        created_at: "2025-01-01T00:00:00Z",
      } as Horizon.ServerApi.TransactionRecord;

      const mockOp = {
        transaction_hash: txHashWithTrades,
        type: "manage_sell_offer",
        source_account: testWallet,
      } as Horizon.ServerApi.OperationRecord;

      // Page 1: 200 trades
      const mockTradesPage1 = Array.from({ length: 200 }, (_, i) => ({
        trade_type: "orderbook",
        base_account: testWallet,
        base_offer_id: offerId,
        base_amount: `${i}.0000000`,
        counter_amount: `${i * 2}.0000000`,
      })) as Horizon.ServerApi.TradeRecord[];

      // Page 2: 100 trades
      const mockTradesPage2 = Array.from({ length: 100 }, (_, i) => ({
        trade_type: "orderbook",
        base_account: testWallet,
        base_offer_id: offerId,
        base_amount: `${200 + i}.0000000`,
        counter_amount: `${(200 + i) * 2}.0000000`,
      })) as Horizon.ServerApi.TradeRecord[];

      // Mock transactions
      mockServer.call.mockResolvedValueOnce({
        records: [mockTx],
      });

      // Mock operations
      mockServer.call.mockResolvedValueOnce({
        records: [mockOp],
      });

      // Mock trades pagination
      const tradesPage2 = {
        records: mockTradesPage2,
        next: vi.fn(),
      };

      const tradesPage1 = {
        records: mockTradesPage1,
        next: vi.fn().mockResolvedValue(tradesPage2),
      };

      mockServer.call.mockResolvedValueOnce(tradesPage1);

      const result = await fetchTransactionsWithOps(testWallet);

      expect(result).toHaveLength(1);
      expect(result[0].trades).toBeDefined();
      expect(result[0].trades).toHaveLength(300); // 200 + 100
      expect(tradesPage1.next).toHaveBeenCalledTimes(1);
    });

    it("should fetch trades for both transactions in offerIdByTxHash", async () => {
      const txHash1 =
        "448e8f032d02fe7d018d5f09761b5bac03bcace1b2c55277d91bd20be160744b";
      const txHash2 =
        "9e3acf4434995cbc6728a7e7e9d73b00e42841b8ddbeb787a9412d72dc6c7593";
      const offerId1 = "1799912560";
      const offerId2 = "1800705918";

      const mockTx1 = {
        hash: txHash1,
        created_at: "2025-01-01T00:00:00Z",
      } as Horizon.ServerApi.TransactionRecord;

      const mockTx2 = {
        hash: txHash2,
        created_at: "2025-01-02T00:00:00Z",
      } as Horizon.ServerApi.TransactionRecord;

      const mockTrades1 = [
        {
          trade_type: "orderbook",
          base_account: testWallet,
          base_offer_id: offerId1,
          base_amount: "100.0000000",
          counter_amount: "200.0000000",
        },
      ] as Horizon.ServerApi.TradeRecord[];

      const mockTrades2 = [
        {
          trade_type: "orderbook",
          counter_account: testWallet,
          counter_offer_id: offerId2,
          base_amount: "50.0000000",
          counter_amount: "150.0000000",
        },
      ] as Horizon.ServerApi.TradeRecord[];

      const mockOps = [
        {
          transaction_hash: txHash1,
          type: "manage_sell_offer",
          source_account: testWallet,
        },
        {
          transaction_hash: txHash2,
          type: "manage_sell_offer",
          source_account: testWallet,
        },
      ] as Horizon.ServerApi.OperationRecord[];

      // Mock transactions
      mockServer.call.mockResolvedValueOnce({
        records: [mockTx1, mockTx2],
      });

      // Mock operations
      mockServer.call.mockResolvedValueOnce({
        records: mockOps,
      });

      // Mock trades for first offer
      mockServer.call.mockResolvedValueOnce({
        records: mockTrades1,
      });

      // Mock trades for second offer
      mockServer.call.mockResolvedValueOnce({
        records: mockTrades2,
      });

      const result = await fetchTransactionsWithOps(testWallet);

      expect(result).toHaveLength(2);

      const tx1Result = result.find((r) => r.tx.hash === txHash1);
      const tx2Result = result.find((r) => r.tx.hash === txHash2);

      expect(tx1Result?.trades).toHaveLength(1);
      expect(tx2Result?.trades).toHaveLength(1);

      // Verify forOffer was called with both offer IDs
      expect(mockServer.forOffer).toHaveBeenCalledWith(offerId1);
      expect(mockServer.forOffer).toHaveBeenCalledWith(offerId2);
    });
  });
});
