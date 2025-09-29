import { describe, expect, it } from "vitest";
import { toCurrency, toStroops } from "./units";

describe("toCurrency", () => {
  it("returns XLM for native", () => {
    expect(toCurrency("native", undefined)).toBe("XLM");
  });

  it("returns assetCode for credit assets", () => {
    expect(toCurrency("credit_alphanum4", "USDC")).toBe("USDC");
    expect(toCurrency("credit_alphanum12", "EURC")).toBe("EURC");
  });

  it("throws if assetCode missing for non-native", () => {
    // @ts-expect-error runtime throws
    expect(() => toCurrency("credit_alphanum4")).toThrow(/Asset code/i);
  });
});

describe("toStroops", () => {
  it("parses integers", () => {
    expect(toStroops("0")).toBe(0n);
    expect(toStroops("1")).toBe(1n);
    expect(toStroops("42")).toBe(42n);
  });

  it("parses dot-decimals to 7 decimals (pad)", () => {
    expect(toStroops("1.2")).toBe(12_000_000n); // 1.2 -> 12,000,000 stroops
    expect(toStroops("1.0000000")).toBe(10_000_000n); // exact 7 dp
    expect(toStroops("0.0000001")).toBe(1n); // 1 stroop
    expect(toStroops("0.000001")).toBe(10n); // 10 stroops
    expect(toStroops(".5")).toBe(5_000_000n); // leading dot
    expect(toStroops("3.")).toBe(30_000_000n); // trailing dot
  });

  it("truncates beyond 7 decimals (no rounding)", () => {
    // 1.23456789 -> keep first 7 digits "2345678"
    expect(toStroops("1.23456789")).toBe(12_345_678n);
    // 0.00000019 -> keep "0000001"
    expect(toStroops("0.00000019")).toBe(1n);
  });
  it("handles big values", () => {
    expect(toStroops("1234567890.1234567")).toBe(12_345_678_901_234_567n);
  });

  it("returns BigInt every time", () => {
    const v = toStroops("0.1");
    expect(typeof v).toBe("bigint");
  });

  it("throws if cannot parse", () => {
    expect(() => toStroops("asdf")).toThrowError(
      new SyntaxError("Cannot convert asdf to a BigInt"),
    );
  });
});
