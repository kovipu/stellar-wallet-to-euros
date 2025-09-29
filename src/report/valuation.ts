import { valueCentsFromStroops } from "../domain/units";
import { dateKeyUTC } from "../pricing/date-keys";
import { PriceBook, priceKey } from "../pricing/price-service";

export type Cents = bigint;

export type BalanceEuroValuation = {
  xlmCents?: Cents;
  usdcCents?: Cents;
  eurcCents?: Cents;
  totalCents: Cents;
};

export type EuroValuation = {
  feeEurCents: Cents; // XLM fee valued in EUR
  // New: portfolio valuation at end of this tx
  balances: BalanceEuroValuation;
};

export function valueTxInEUR(
  txRow: TxRow,
  priceBook: PriceBook,
): EuroValuation {
  const dk = dateKeyUTC(txRow.date);

  // --- fee valuation (EUR cents) ---
  const feeMicro = getMicro(priceBook, "XLM", dk);
  const feeEurCents = feeMicro
    ? valueCentsFromStroops(txRow.feeStroops, feeMicro)
    : 0n;

  // --- balances valuation (EUR cents) ---
  const xlmMicro = getMicro(priceBook, "XLM", dk);
  const usdcMicro = getMicro(priceBook, "USDC", dk);
  const eurcMicro = getMicro(priceBook, "EURC", dk);

  const xlmCents = xlmMicro
    ? valueCentsFromStroops(txRow.balances.XLM, xlmMicro)
    : undefined;
  const usdcCents = usdcMicro
    ? valueCentsFromStroops(txRow.balances.USDC, usdcMicro)
    : undefined;
  const eurcCents = eurcMicro
    ? valueCentsFromStroops(txRow.balances.EURC, eurcMicro)
    : undefined;

  const totalCents = (xlmCents ?? 0n) + (usdcCents ?? 0n) + (eurcCents ?? 0n);

  return {
    feeEurCents,
    balances: {
      xlmCents,
      usdcCents,
      eurcCents,
      totalCents,
    },
  };
}

const getMicro = (pb: PriceBook, currency: Currency, dk: string) =>
  pb[priceKey(currency, dk)]?.priceMicroEur ?? undefined;
