import { stringify } from "csv-stringify/sync";
import { formatCents, toDecimal } from "../domain/units";
import { PriceBook } from "../pricing/price-service";
import { valueTxInEUR } from "../report/valuation";
import { writeFileSync } from "fs";

/** Convert TxRows to a csv format and log to console for now */
export const buildTransactionsCsv = (txRows: TxRow[], priceBook: PriceBook) => {
  const view = txRows.map((tx) => {
    const { balances, feeEurCents } = valueTxInEUR(tx, priceBook);
    return {
      "Päivämäärä (UTC)": tx.date.toISOString(),
      Tyyppi: tx.ops.map((op) => op.kind).join(", "),
      "Verkkopalkkio (XLM)": toDecimal(tx.feeStroops),
      "Verkkopalkkio (€)": formatCents(feeEurCents),
      "XLM-saldo": toDecimal(tx.balances.XLM),
      "XLM-saldo (€)":
        balances.xlmCents !== undefined ? formatCents(balances.xlmCents) : "",
      "USDC-saldo": toDecimal(tx.balances.USDC),
      "USDC-saldo (€)":
        balances.usdcCents !== undefined ? formatCents(balances.usdcCents) : "",
      "EURC-saldo": toDecimal(tx.balances.EURC),
      "Kokonaissaldo (€)":
        balances.totalCents !== undefined
          ? formatCents(balances.totalCents)
          : "",
      "Tapahtuman linkki": `https://stellar.expert/explorer/public/tx/${tx.transactionHash}`,
    };
  });

  return stringify(view, {
    header: true,
    columns: [
      "Päivämäärä (UTC)",
      "Tyyppi",
      "Verkkopalkkio (XLM)",
      "Verkkopalkkio (€)",
      "XLM-saldo",
      "XLM-saldo (€)",
      "USDC-saldo",
      "USDC-saldo (€)",
      "EURC-saldo",
      "Kokonaissaldo (€)",
      "Tapahtuman linkki",
    ],
  });
};

export function writeTransactionsCsvFile(
  txRows: TxRow[],
  priceBook: PriceBook,
  filePath = "report.csv",
): void {
  const csv = buildTransactionsCsv(txRows, priceBook);
  writeFileSync(filePath, csv, "utf8");
  console.log(`Wrote ${filePath}`);
}
