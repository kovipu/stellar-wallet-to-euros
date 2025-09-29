import { stringify } from "csv-stringify/sync";
import { formatCents, toDecimal } from "../domain/units";
import { PriceBook } from "../pricing/price-service";
import { valueTxInEUR } from "../report/valuation";
import { writeFileSync } from "fs";

/** Convert TxRows to a csv format and log to console for now */
export const buildCsv = (txRows: TxRow[], priceBook: PriceBook) => {
  const view = txRows.map((tx) => {
    const { balances, feeEurCents } = valueTxInEUR(tx, priceBook);
    return {
      Date: tx.date.toISOString(),
      Type: tx.ops.map((op) => op.kind).join(", "),
      Fee: toDecimal(tx.feeStroops),
      "Fee (EUR)": formatCents(feeEurCents),
      "XLM Balance": toDecimal(tx.balances.XLM),
      "USDC Balance": toDecimal(tx.balances.USDC),
      "EURC Balance": toDecimal(tx.balances.EURC),
      "XLM Balance (EUR)":
        balances.xlmCents !== undefined ? formatCents(balances.xlmCents) : "",
      "USDC Balance (EUR)":
        balances.usdcCents !== undefined ? formatCents(balances.usdcCents) : "",
      "EURC Balance (EUR)":
        balances.eurcCents !== undefined ? formatCents(balances.eurcCents) : "",
      "Transaction Explorer": `https://stellar.expert/explorer/public/tx/${tx.transactionHash}`,
    };
  });

  return stringify(view, {
    header: true,
    columns: [
      "Date",
      "Type",
      "Fee",
      "Fee (EUR)",
      "XLM Balance",
      "USDC Balance",
      "EURC Balance",
      "XLM Balance (EUR)",
      "USDC Balance (EUR)",
      "EURC Balance (EUR)",
      "Transaction Explorer",
    ],
  });
};

export function writeCsvFile(
  txRows: TxRow[],
  priceBook: PriceBook,
  filePath = "report.csv",
): void {
  const csv = buildCsv(txRows, priceBook);
  writeFileSync(filePath, csv, "utf8");
  console.log(`CSV written: ${filePath}`);
}
