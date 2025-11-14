import { stringify } from "csv-stringify/sync";
import { formatCents, toDecimal } from "../domain/units";
import { PriceBook } from "../pricing/price-service";
import { valueTxInEUR } from "../report/valuation";
import { writeFileSync } from "fs";
import { DispKind, Fill } from "../report/fifo";
import { dispKindFi } from "./fifo-csv";

/** Convert TxRows to a csv format */
export const buildTransactionsCsv = (
  txRows: TxRow[],
  priceBook: PriceBook,
  fills: ReadonlyArray<Fill>,
) => {
  const plByTx = indexFillsByTx(fills);

  const view = txRows.map((tx) => {
    const { balances, feeEurCents, flow } = valueTxInEUR(tx, priceBook);
    const agg = plByTx.get(tx.transactionHash) ?? {
      proceeds: 0n,
      cost: 0n,
      pl: 0n,
      batchIds: new Set<string>(),
      dispKinds: new Set<DispKind>(),
    };

    return {
      "Päivämäärä (UTC)": tx.date.toISOString(),
      "Luovutuksen tyyppi": Array.from(agg.dispKinds)
        .map(dispKindFi)
        .join(", "),
      "Luovutuserien ID:t": Array.from(agg.batchIds).join(", "),
      Tyyppi: tx.ops.map((op) => op.kind).join(", "),
      "Arvo sisään (€)": formatCents(flow.inCents),
      "Arvo ulos (€)": formatCents(flow.outCents),
      "Nettoarvo (€)": formatCents(flow.netCents),
      "Luovutushinta (€)": formatCents(agg.proceeds),
      "Hankintameno (€)": formatCents(agg.cost),
      "FIFO-voitto/tappio (€)": formatCents(agg.pl),
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
      "Luovutuksen tyyppi",
      "Luovutuserien ID:t",
      "Tyyppi",
      "Arvo sisään (€)",
      "Arvo ulos (€)",
      "Nettoarvo (€)",
      "Luovutushinta (€)",
      "Hankintameno (€)",
      "FIFO-voitto/tappio (€)",
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
  fills: ReadonlyArray<Fill>,
  filePath = "transactions.csv",
): void {
  const csv = buildTransactionsCsv(txRows, priceBook, fills);
  writeFileSync(filePath, csv, "utf8");
  console.log(`Wrote ${filePath}`);
}

type FillByTx = Map<
  string,
  {
    proceeds: bigint;
    cost: bigint;
    pl: bigint;
    batchIds: Set<string>;
    dispKinds: Set<DispKind>;
  }
>;

function indexFillsByTx(fills: ReadonlyArray<Fill>): FillByTx {
  const m: FillByTx = new Map();
  for (const f of fills) {
    const cur = m.get(f.txHash) ?? {
      proceeds: 0n,
      cost: 0n,
      pl: 0n,
      batchIds: new Set<string>(),
      dispKinds: new Set<DispKind>(),
    };
    cur.batchIds.add(f.batchId);
    cur.dispKinds.add(f.dispKind);
    m.set(f.txHash, {
      proceeds: cur.proceeds + f.proceedsCents,
      cost: cur.cost + f.costCents,
      pl: cur.pl + f.gainLossCents,
      batchIds: cur.batchIds,
      dispKinds: cur.dispKinds,
    });
  }
  return m;
}
