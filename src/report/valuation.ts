import { MICRO_PER_EUR, valueCentsFromStroops } from "../domain/units";
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
  balances: BalanceEuroValuation;
  flow: {
    inCents: bigint;
    outCents: bigint;
    netCents: bigint;
    byAsset: FlowByAsset;
  };
};

type FlowByAsset = Partial<
  Record<Currency, { inCents: bigint; outCents: bigint }>
>;

export function valueTxInEUR(
  txRow: TxRow,
  priceBook: PriceBook,
): EuroValuation {
  const dk = dateKeyUTC(txRow.date);

  // Network fee (shown separately; not counted in "outCents" to avoid double counting)
  const feeMicro = priceMicroAt(priceBook, "XLM", dk);
  const feeEurCents = feeMicro
    ? valueCentsFromStroops(txRow.feeStroops, feeMicro)
    : 0n;

  // balances valuation (EUR cents)
  const xlmCents = valueCentsFromStroops(
    txRow.balances.XLM,
    priceMicroAt(priceBook, "XLM", dk),
  );
  const usdcCents = valueCentsFromStroops(
    txRow.balances.USDC,
    priceMicroAt(priceBook, "USDC", dk),
  );
  const eurcCents = valueCentsFromStroops(
    txRow.balances.EURC,
    priceMicroAt(priceBook, "EURC", dk),
  );
  const totalCents = xlmCents + usdcCents + eurcCents;

  // per-tx flow (EUR cents)
  let inCents = 0n;
  let outCents = 0n;
  const byAsset: FlowByAsset = {};

  const addIn = (currency: Currency, stroops: bigint) => {
    if (stroops === 0n) return;
    const c = valueCentsFromStroops(
      stroops,
      priceMicroAt(priceBook, currency, dk),
    );
    inCents += c;
    const cur = byAsset[currency] ?? { inCents: 0n, outCents: 0n };
    byAsset[currency] = { ...cur, inCents: cur.inCents + c };
  };

  const addOut = (currency: Currency, stroops: bigint) => {
    if (stroops === 0n) return;
    const c = valueCentsFromStroops(
      stroops,
      priceMicroAt(priceBook, currency, dk),
    );
    outCents += c;
    const cur = byAsset[currency] ?? { inCents: 0n, outCents: 0n };
    byAsset[currency] = { ...cur, outCents: cur.outCents + c };
  };

  txRow.ops.forEach((op) => {
    if (op.kind === "create_account") {
      addIn("XLM", op.amountStroops);
    } else if (op.kind === "payment") {
      (op.direction === "in" ? addIn : addOut)(op.currency, op.amountStroops);
    } else if (op.kind === "swap") {
      addOut(op.sourceCurrency, op.sourceAmountStroops);
      addIn(op.destinationCurrency, op.destinationAmountStroops);
    } else if (op.kind === "blend_deposit") {
      addOut(op.currency, op.amountStroops);
    } else if (op.kind === "blend_withdraw") {
      addIn(op.currency, op.amountStroops);
    } else if (op.kind === "swap_fee") {
      addOut(op.currency, op.amountStroops);
    }
  });

  return {
    feeEurCents,
    balances: {
      xlmCents,
      usdcCents,
      eurcCents,
      totalCents,
    },
    flow: {
      inCents,
      outCents,
      netCents: inCents - outCents,
      byAsset,
    },
  };
}

const priceMicroAt = (
  book: PriceBook,
  currency: Currency,
  dateKey: string,
): bigint => {
  if (currency === "EURC") return MICRO_PER_EUR;
  const key = priceKey(currency, dateKey);
  const p = book[key]?.priceMicroEur;
  if (p === undefined) throw new Error(`Missing price for ${key}`);
  return p;
};
