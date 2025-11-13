import { writeFileSync } from "fs";
import { AcqKind, Batch, DispKind, Fill } from "../report/fifo";
import { formatCents, formatPriceMicro, toDecimal } from "../domain/units";
import { stringify } from "csv-stringify/sync";

/* -------------------------- Events CSV ---------------------------- */

type Event =
  | {
      type: "acquisition";
      date: Date;
      batch: Batch;
    }
  | {
      type: "disposal";
      date: Date;
      fill: Fill;
    };

export function buildEventsCsv(
  batches: Record<Currency, Batch[]>,
  fills: ReadonlyArray<Fill>,
): string {
  const events: Event[] = [];

  // Add all acquisitions (batches)
  for (const [_currency, batchList] of Object.entries(batches)) {
    for (const batch of batchList) {
      // Skip EURC par batch if it was never used
      if (batch.batchId === "EURC#PAR" && batch.qtyInitialStroops === 0n) {
        continue;
      }
      events.push({
        type: "acquisition",
        date: batch.acquiredAt,
        batch,
      });
    }
  }

  // Add all disposals (fills)
  for (const fill of fills) {
    events.push({
      type: "disposal",
      date: fill.disposedAt,
      fill,
    });
  }

  // Sort by: 1) currency, 2) type (acquisition before disposal), 3) timestamp
  events.sort((a, b) => {
    const currencyA =
      a.type === "acquisition" ? a.batch.currency : a.fill.currency;
    const currencyB =
      b.type === "acquisition" ? b.batch.currency : b.fill.currency;

    // First sort by currency
    if (currencyA !== currencyB) {
      return currencyA.localeCompare(currencyB);
    }

    // Then by type (acquisitions before disposals)
    if (a.type !== b.type) {
      return a.type === "acquisition" ? -1 : 1;
    }

    // Finally by timestamp
    return a.date.getTime() - b.date.getTime();
  });

  const rows = events.map((e) => {
    if (e.type === "acquisition") {
      const b = e.batch;
      const totalCostCents =
        (b.qtyInitialStroops * b.priceMicroAtAcq + 50_000_000_000n) /
        100_000_000_000n;

      return {
        Tyyppi: "Hankinta",
        "Luovutushetki (UTC)": "", // No disposal yet
        Toiminto: acqKindFi(b.acqKind),
        Valuutta: b.currency,
        Määrä: toDecimal(b.qtyInitialStroops),
        "Erä ID": b.batchId,
        "Hankintahetki (UTC)": b.acquiredAt.toISOString(),
        "Hankintahinta (€/kpl)": formatPriceMicro(b.priceMicroAtAcq),
        "Luovutushinta (€/kpl)": "", // No disposal price yet
        "Luovutushinta (€)": "", // No proceeds yet
        "Hankintameno (€)": formatCents(totalCostCents),
        "Voitto/Tappio (€)": "", // No gain/loss yet
        "Transaction Hash": b.acqTxHash,
      };
    } else {
      const f = e.fill;
      return {
        Tyyppi: "Luovutus",
        "Luovutushetki (UTC)": f.disposedAt.toISOString(),
        Toiminto: dispKindFi(f.dispKind),
        Valuutta: f.currency,
        Määrä: toDecimal(f.amountStroops),
        "Erä ID": f.batchId,
        "Hankintahetki (UTC)": f.acquiredAt.toISOString(),
        "Hankintahinta (€/kpl)": formatPriceMicro(f.acqPriceMicro),
        "Luovutushinta (€/kpl)": formatPriceMicro(f.dispPriceMicro),
        "Luovutushinta (€)": formatCents(f.proceedsCents),
        "Hankintameno (€)": formatCents(f.costCents),
        "Voitto/Tappio (€)": formatCents(f.gainLossCents),
        "Transaction Hash": f.txHash,
      };
    }
  });

  return stringify(rows, {
    header: true,
    columns: [
      "Tyyppi",
      "Luovutushetki (UTC)",
      "Toiminto",
      "Valuutta",
      "Määrä",
      "Erä ID",
      "Hankintahetki (UTC)",
      "Hankintahinta (€/kpl)",
      "Luovutushinta (€/kpl)",
      "Luovutushinta (€)",
      "Hankintameno (€)",
      "Voitto/Tappio (€)",
      "Transaction Hash",
    ],
  });
}

// Finnish labels
export const acqKindFi = (k: AcqKind): string =>
  ({
    create_account: "Tilin rahoitus",
    payment_in: "Maksu sisään",
    swap_in: "Vaihto (sisään)",
    blend_withdraw: "Blend-nosto",
    eurc_par: "EURC nimellisarvo",
  })[k];

export const dispKindFi = (k: DispKind): string =>
  ({
    payment_out: "Maksu ulos",
    swap_out: "Vaihto (ulos)",
    blend_deposit: "Blend-talletus",
    swap_fee: "Vaihtopalkkio",
    network_fee: "Verkkopalkkio",
  })[k];

export function writeEventsCsvFile(
  batches: Record<Currency, Batch[]>,
  fills: ReadonlyArray<Fill>,
  path = "events.csv",
) {
  const csv = buildEventsCsv(batches, fills);
  writeFileSync(path, csv, "utf8");
  const totalEvents =
    Object.values(batches)
      .flat()
      .filter((b) => b.qtyInitialStroops > 0n).length + fills.length;
  console.log(`Wrote ${path} (${totalEvents} events)`);
}

/* ------------------------- Inventory CSV -------------------------- */

export function buildInventoryCsv(ending: Record<string, Batch[]>): string {
  const rows = [];
  for (const [currency, batches] of Object.entries(ending)) {
    for (const b of batches) {
      if (b.qtyRemainingStroops === 0n) continue;
      rows.push({
        Valuutta: currency,
        "Erä ID": b.batchId,
        "Hankintahetki (UTC)": b.acquiredAt.toISOString(),
        "Hankintahinta (€/kpl)": formatPriceMicro(b.priceMicroAtAcq),
        "Erän koko (kpl)": toDecimal(b.qtyInitialStroops),
        "Erää jäljellä (kpl)": toDecimal(b.qtyRemainingStroops),
        // Remaining cost basis at acquisition price (not marked-to-market)
        "Jäljellä oleva hankintameno (€)": formatCents(
          // qtyRemainingAtomic * acq micro-€ -> cents (rounded)
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
      "Valuutta",
      "Erä ID",
      "Hankintahetki (UTC)",
      "Hankintahinta (€/kpl)",
      "Erän koko (kpl)",
      "Erää jäljellä (kpl)",
      "Jäljellä oleva hankintameno (€)",
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
