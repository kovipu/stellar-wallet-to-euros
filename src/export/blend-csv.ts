import { writeFileSync } from "fs";
import { stringify } from "csv-stringify/sync";
import { toDecimal, formatCents, formatPriceMicro } from "../domain/units";
import type { BlendDailyRow } from "../blend/types";

const COLUMNS = [
  "Päivämäärä",
  "Pooli",
  "Valuutta",
  "Saldo (kpl)",
  "Talletukset (kpl)",
  "Nostot (kpl)",
  "Tuotto (kpl)",
  "Kum. tuotto (kpl)",
  "APY (%)",
  "Hinta (€/kpl)",
  "Saldo (€)",
  "Tuotto (€)",
  "Kum. tuotto (€)",
] as const;

function emptyRow(): Record<string, string> {
  const row: Record<string, string> = {};
  for (const col of COLUMNS) row[col] = "";
  return row;
}

function formatApy(apy: number): string {
  return apy.toFixed(2).replace(".", ",");
}

export function buildBlendCsv(rows: ReadonlyArray<BlendDailyRow>): string {
  const csvRows: Record<string, string>[] = [];
  let prevPositionKey = "";

  for (const row of rows) {
    const positionKey = `${row.poolId}:${row.assetAddress}`;

    // Separator row between positions
    if (prevPositionKey && positionKey !== prevPositionKey) {
      csvRows.push(emptyRow());
    }
    prevPositionKey = positionKey;

    csvRows.push({
      Päivämäärä: row.date,
      Pooli: row.poolName,
      Valuutta: row.currency,
      "Saldo (kpl)": toDecimal(row.balanceStroops),
      "Talletukset (kpl)":
        row.depositsStroops > 0n ? toDecimal(row.depositsStroops) : "",
      "Nostot (kpl)":
        row.withdrawalsStroops > 0n ? toDecimal(row.withdrawalsStroops) : "",
      "Tuotto (kpl)": toDecimal(row.yieldStroops),
      "Kum. tuotto (kpl)": toDecimal(row.cumulativeYieldStroops),
      "APY (%)": formatApy(row.apyPercent),
      "Hinta (€/kpl)": formatPriceMicro(row.priceEurMicro),
      "Saldo (€)": formatCents(row.balanceEurCents),
      "Tuotto (€)": formatCents(row.yieldEurCents),
      "Kum. tuotto (€)": formatCents(row.cumulativeYieldEurCents),
    });
  }

  return stringify(csvRows, {
    header: true,
    columns: [...COLUMNS],
  });
}

export function writeBlendCsvFile(
  rows: ReadonlyArray<BlendDailyRow>,
  path = "blend_pnl.csv",
): void {
  const csv = buildBlendCsv(rows);
  writeFileSync(path, csv, "utf8");
  console.log(`Wrote ${path} (${rows.length} daily rows)`);
}

/**
 * Pivoted CSV for charting: one row per date, one column per position.
 * Columns: Päivämäärä, <PoolName> <Currency> (€), ...
 */
export function buildBlendChartCsv(rows: ReadonlyArray<BlendDailyRow>): string {
  // Discover position labels in stable order
  const positionLabels: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.poolId}:${row.assetAddress}`;
    if (!seen.has(key)) {
      seen.add(key);
      positionLabels.push(`${row.poolName} ${row.currency} (€)`);
    }
  }

  // Build date -> { label -> value } map
  const dateMap = new Map<string, Map<string, string>>();
  for (const row of rows) {
    const label = `${row.poolName} ${row.currency} (€)`;
    let cols = dateMap.get(row.date);
    if (!cols) {
      cols = new Map<string, string>();
      dateMap.set(row.date, cols);
    }
    cols.set(label, formatCents(row.balanceEurCents));
  }

  // Build CSV rows sorted by date
  const dates = Array.from(dateMap.keys()).sort();
  const columns = ["Päivämäärä", ...positionLabels];
  const csvRows: Record<string, string>[] = [];

  for (const date of dates) {
    const cols = dateMap.get(date)!;
    const csvRow: Record<string, string> = { Päivämäärä: date };
    for (const label of positionLabels) {
      csvRow[label] = cols.get(label) ?? "";
    }
    csvRows.push(csvRow);
  }

  return stringify(csvRows, { header: true, columns });
}

export function writeBlendChartCsvFile(
  rows: ReadonlyArray<BlendDailyRow>,
  path = "blend_chart.csv",
): void {
  const csv = buildBlendChartCsv(rows);
  writeFileSync(path, csv, "utf8");
  console.log(`Wrote ${path} (${new Set(rows.map((r) => r.date)).size} dates)`);
}
