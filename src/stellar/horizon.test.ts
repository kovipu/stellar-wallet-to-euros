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
    vi.spyOn(console, "log").mockImplementation(() => { });
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

    it("should handle transactions without operations", async () => {
      const mockTx = {
        hash: "tx1",
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

      const result = await fetchTransactionsWithOps(testWallet);

      expect(result).toHaveLength(1);
      expect(result[0].tx.hash).toBe("tx1");
      expect(result[0].ops).toHaveLength(0);
      expect(result[0].trades).toBeUndefined();
    });
  });

  describe("Pagination Logic", () => {
    it("transactions – should fetch single page when results < 200", async () => {
      const mockTxs = Array.from({ length: 150 }, (_, i) => ({
        hash: `tx${i}`,
        created_at: "2025-01-01T00:00:00Z",
      })) as Horizon.ServerApi.TransactionRecord[];

      // Mock transactions page with < 200 records
      mockServer.call.mockResolvedValueOnce({
        records: mockTxs,
        next: vi.fn(),
      });

      // Mock operations page
      mockServer.call.mockResolvedValueOnce({
        records: [],
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

      const mockPage2 = {
        records: mockTxsPage2,
        next: vi.fn(),
      };

      const mockPage1 = {
        records: mockTxsPage1,
        next: vi.fn().mockResolvedValue(mockPage2),
      };

      // Mock transactions pagination
      mockServer.call.mockResolvedValueOnce(mockPage1);

      // Mock operations page
      mockServer.call.mockResolvedValueOnce({
        records: [],
      });

      const result = await fetchTransactionsWithOps(testWallet);

      expect(result).toHaveLength(300);
      expect(mockPage1.next).toHaveBeenCalledTimes(1);
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

    it("should exclude payment operations to/from other wallets", async () => {
      const mockTx = {
        hash: "tx1",
        created_at: "2025-01-01T00:00:00Z",
      } as Horizon.ServerApi.TransactionRecord;

      const mockDustingOp = {
        transaction_hash: "tx1",
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

      const result = await fetchTransactionsWithOps(testWallet);

      expect(result[0].ops).toHaveLength(0); // Filtered out
    });

    it("should include create_claimable_balance where wallet is a claimant", async () => {
      const mockTx = {
        hash: "tx1",
        created_at: "2025-01-01T00:00:00Z",
      } as Horizon.ServerApi.TransactionRecord;

      const mockOp = {
        transaction_hash: "tx1",
        type: "create_claimable_balance",
        claimants: [
          { destination: "OTHER_WALLET" },
          { destination: testWallet },
        ],
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

    it("should exclude create_claimable_balance where wallet is NOT a claimant", async () => {
      const mockTx = {
        hash: "tx1",
        created_at: "2025-01-01T00:00:00Z",
      } as Horizon.ServerApi.TransactionRecord;

      const mockOp = {
        transaction_hash: "tx1",
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

      const result = await fetchTransactionsWithOps(testWallet);

      expect(result[0].ops).toHaveLength(0); // Filtered out
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
          type: "manage_sell_offer",
          source_account: testWallet,
        },
        {
          transaction_hash: "tx1",
          type: "set_options",
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
});
