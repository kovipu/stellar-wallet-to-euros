import { stringify } from "csv-stringify/sync";
import { toDecimal } from "../domain/units";

/** Convert TxRows to a csv format and log to console for now */
export const exportToCsv = (output: TxRow[]) => {
  const outputCsv = stringify(
    output.map((tx) => {
      return {
        Date: tx.date.toISOString(),
        Type: tx.ops.map((op) => op.kind).join(", "),
        Fee: toDecimal(tx.feeStroops),
        "XLM Balance": toDecimal(tx.balances.XLM),
        "USDC Balance": toDecimal(tx.balances.USDC),
        "EURC Balance": toDecimal(tx.balances.EURC),
        "Transaction Explorer": `https://stellar.expert/explorer/public/tx/${tx.transactionHash}`,
      };
    }),
    {
      header: true,
      columns: [
        "Date",
        "Type",
        "Fee",
        "XLM Balance",
        "USDC Balance",
        "EURC Balance",
        "Transaction Explorer",
      ],
    },
  );
  console.log(outputCsv);
};
