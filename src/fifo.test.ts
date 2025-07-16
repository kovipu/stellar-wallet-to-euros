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
        const {transactions} = await processTransactions(mockOperations, accountId);

        expect(transactions).toHaveLength(1);
        expect(transactions[0].type).toBe("create_account");
        expect(transactions[0].amountStroops).toBe(50_000_000n);
        expect(transactions[0].currency).toBe("XLM");
        expect(transactions[0].date).toStrictEqual(new Date("2024-01-01T00:00:00Z"));
        expect(transactions[0].fromAddress).toBe("GBX...");
        expect(transactions[0].toAddress).toBe(accountId);
    });
});