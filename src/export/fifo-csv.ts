import { writeFileSync } from "fs";
import { Batch, Fill } from "../report/fifo";
import { formatCents, formatPriceMicro, toDecimal } from "../domain/units";
import { stringify } from "csv-stringify/sync";

/* ---------------------------- Fills CSV --------------------------- */

export function buildFillsCsv(fills: ReadonlyArray<Fill>): string {
  const rows = fills.map((f) => ({
    "Disposed At (UTC)": f.disposedAt.toISOString(),
    "Disposal kind": f.dispKind,
    "Tx Hash": f.txHash,
    Currency: f.currency,
    "Qty (units)": toDecimal(f.amountStroops),
    "Batch ID": f.batchId,
    "Acquired At (UTC)": f.acquiredAt.toISOString(),
    "Acq Price (EUR/unit)": formatPriceMicro(f.acqPriceMicro),
    "Disp Price (EUR/unit)": formatPriceMicro(f.dispPriceMicro),
    "Proceeds (EUR)": formatCents(f.proceedsCents),
    "Cost (EUR)": formatCents(f.costCents),
    "P/L (EUR)": formatCents(f.gainLossCents),
  }));

  // Use semicolon so Excel (EU locale) parses numbers with comma decimals nicely
  return stringify(rows, {
    header: true,
    columns: [
      "Disposed At (UTC)",
      "Disposal kind",
      "Tx Hash",
      "Currency",
      "Qty (units)",
      "Batch ID",
      "Acquired At (UTC)",
      "Acq Price (EUR/unit)",
      "Disp Price (EUR/unit)",
      "Proceeds (EUR)",
      "Cost (EUR)",
      "P/L (EUR)",
    ],
  });
}

export function writeFillsCsvFile(
  fills: ReadonlyArray<Fill>,
  path = "fifo_fills.csv",
) {
  writeFileSync(path, buildFillsCsv(fills), "utf8");
  console.log(`Wrote ${path} (${fills.length} fills)`);
}

/* ------------------------- Inventory CSV -------------------------- */

export function buildInventoryCsv(ending: Record<string, Batch[]>): string {
  const rows = [];
  for (const [currency, batches] of Object.entries(ending)) {
    for (const b of batches) {
      if (b.qtyRemainingStroops === 0n) continue;
      rows.push({
        Currency: currency,
        "Batch ID": b.batchId,
        "Acquired At (UTC)": b.acquiredAt.toISOString(),
        "Acq Price (EUR/unit)": formatPriceMicro(b.priceMicroAtAcq),
        "Qty Initial (units)": toDecimal(b.qtyInitialStroops),
        "Qty Remaining (units)": toDecimal(b.qtyRemainingStroops),
        // Remaining cost basis at acquisition price (not marked-to-market)
        "Remaining Cost (EUR)": formatCents(
          // qtyRemainingAtomic * acq micro-EUR -> cents (rounded)
          // same math as valueCentsFromAtomic but inline to keep this file standalone
          (() => {
            const num = b.qtyRemainingStroops * b.priceMicroAtAcq; // atoms * micro
            const denom = 100_000_000_000n; // 10^11 (7dp * micro->cent)
            return (num + denom / 2n) / denom;
          })(),
        ),
      });
    }
  }

  return stringify(rows, {
    header: true,
    columns: [
      "Currency",
      "Batch ID",
      "Acquired At (UTC)",
      "Acq Price (EUR/unit)",
      "Qty Initial (units)",
      "Qty Remaining (units)",
      "Remaining Cost (EUR)",
    ],
  });
}

export function writeInventoryCsvFile(
  ending: Record<string, Batch[]>,
  path = "fifo_inventory.csv",
) {
  writeFileSync(path, buildInventoryCsv(ending), "utf8");
  console.log(`Wrote ${path}`);
}
