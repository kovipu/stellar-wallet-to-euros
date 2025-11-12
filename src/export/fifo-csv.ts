import { writeFileSync } from "fs";
import { AcqKind, Batch, DispKind, Fill } from "../report/fifo";
import { formatCents, formatPriceMicro, toDecimal } from "../domain/units";
import { stringify } from "csv-stringify/sync";

/* ---------------------------- Fills CSV --------------------------- */

export function buildFillsCsv(fills: ReadonlyArray<Fill>): string {
  const visibleFills = fills.filter((f) => !isDustFill(f));

  const rows = visibleFills.map((f) => ({
    "Luovutushetki (UTC)": f.disposedAt.toISOString(),
    "Luovutuksen tyyppi": dispKindFi(f.dispKind),
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
  }));

  // append summary of hidden rows
  const hidden = fills.filter((f) => isDustFill(f));
  const sum = hidden.reduce(
    (acc, f) => {
      acc.proceeds += f.proceedsCents;
      acc.cost += f.costCents;
      acc.pl += f.gainLossCents;
      return acc;
    },
    { proceeds: 0n, cost: 0n, pl: 0n },
  );

  // Blank separator line
  rows.push({ "Luovutushetki (UTC)": "", "Tapahtuman hash": "" } as any);

  rows.push({
    "Luovutushetki (UTC)": "Yhteenveto: piilotettuja rivejä (arvo < 0,01 €",
    "Luovutuksen tyyppi": `${hidden.length} kpl`,
    Valuutta: "",
    Määrä: "",
    "Erä-ID": "",
    "Hankintahetki (UTC)": "",
    "Hankintahinta (€/kpl)": "",
    "Luovutushinta (€/kpl)": "",
    "Luovutushinta (€)": formatCents(sum.proceeds),
    "Hankintameno (€)": formatCents(sum.cost),
    "Voitto/Tappio (€)": formatCents(sum.pl),
  } as any);

  // Use semicolon so Excel (EU locale) parses numbers with comma decimals nicely
  return stringify(rows, {
    header: true,
    columns: [
      "Luovutushetki (UTC)",
      "Luovutuksen tyyppi",
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

const DUST_THRESHOLD_CENTS = 1n; // < 0.01€

// Hide only if everything rounds to 0 cents.
const isDustFill = (f: Fill) =>
  abs(f.proceedsCents) < DUST_THRESHOLD_CENTS &&
  abs(f.costCents) < DUST_THRESHOLD_CENTS &&
  abs(f.gainLossCents) < DUST_THRESHOLD_CENTS;

const abs = (x: bigint) => (x < 0n ? -x : x);

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
