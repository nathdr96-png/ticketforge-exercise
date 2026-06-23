import { describe, expect, it } from "vitest";
import {
  assertIntegerCents,
  currencySymbol,
  discountCents,
  feeCents,
  formatCents,
  formatMoney,
  previewBreakdown,
  sumCents,
} from "./money";

describe("formatCents", () => {
  it("formats whole and fractional amounts exactly", () => {
    expect(formatCents(0)).toBe("0.00");
    expect(formatCents(1)).toBe("0.01");
    expect(formatCents(9)).toBe("0.09");
    expect(formatCents(10)).toBe("0.10");
    expect(formatCents(99)).toBe("0.99");
    expect(formatCents(100)).toBe("1.00");
    expect(formatCents(105)).toBe("1.05");
    expect(formatCents(7000)).toBe("70.00");
    expect(formatCents(123456)).toBe("1,234.56");
  });

  it("groups thousands", () => {
    expect(formatCents(100000)).toBe("1,000.00");
    expect(formatCents(99999999)).toBe("999,999.99");
    expect(formatCents(123456789012)).toBe("1,234,567,890.12");
  });

  it("handles negative amounts", () => {
    expect(formatCents(-1)).toBe("-0.01");
    expect(formatCents(-123456)).toBe("-1,234.56");
  });

  it("never loses a cent to floating point", () => {
    // 0.1 + 0.2 style drift is impossible because nothing is ever divided.
    expect(formatCents(1 + 2)).toBe("0.03");
    for (const cents of [8299, 1999, 2999, 70001, 5050505]) {
      const [major, minor] = formatCents(cents).replace(/,/g, "").split(".");
      expect(Number(major) * 100 + Number(minor)).toBe(cents);
    }
  });

  it("rejects non-integer input instead of silently rounding", () => {
    expect(() => formatCents(10.5)).toThrow(TypeError);
    expect(() => formatCents(Number.NaN)).toThrow(TypeError);
    // @ts-expect-error deliberately wrong type
    expect(() => formatCents("100")).toThrow(TypeError);
  });
});

describe("formatMoney", () => {
  it("prefixes the currency symbol", () => {
    expect(formatMoney(7000, "USD")).toBe("$70.00");
    expect(formatMoney(7000, "EUR")).toBe("€70.00");
    expect(formatMoney(7000, "GBP")).toBe("£70.00");
  });

  it("falls back to no symbol for unknown currencies", () => {
    expect(currencySymbol("XYZ")).toBe("");
    expect(formatMoney(150, "XYZ")).toBe("1.50");
  });
});

describe("sumCents / assertIntegerCents", () => {
  it("adds integer prices", () => {
    expect(sumCents([])).toBe(0);
    expect(sumCents([7000, 6000, 5500])).toBe(18500);
  });

  it("refuses float prices", () => {
    expect(() => sumCents([70.005])).toThrow(TypeError);
    expect(() => assertIntegerCents(1.0000001)).toThrow(TypeError);
    expect(assertIntegerCents(42)).toBe(42);
  });
});

describe("contract money formulas (T3-orders-money.md)", () => {
  it("discount_cents = floor(subtotal * percent / 100)", () => {
    expect(discountCents(10000, 10)).toBe(1000);
    expect(discountCents(7001, 10)).toBe(700); // floor, not round
    expect(discountCents(19999, 10)).toBe(1999);
    expect(discountCents(12345, 20)).toBe(2469);
    expect(discountCents(5000, 0)).toBe(0);
  });

  it("rejects nonsense percentages", () => {
    expect(() => discountCents(1000, 101)).toThrow(RangeError);
    expect(() => discountCents(1000, -1)).toThrow(RangeError);
    expect(() => discountCents(1000, 10.5)).toThrow(RangeError);
  });

  it("fee_cents = floor(subtotal_after_discount * 5 / 100) + 30", () => {
    expect(feeCents(0)).toBe(30);
    expect(feeCents(7000)).toBe(380);
    expect(feeCents(19)).toBe(30); // floor(0.95) === 0
    expect(feeCents(20)).toBe(31);
    expect(feeCents(12345)).toBe(647); // floor(617.25) + 30
  });

  it("total_cents = (subtotal - discount) + fee", () => {
    expect(previewBreakdown(7000)).toEqual({
      subtotal_cents: 7000,
      discount_cents: 0,
      fee_cents: 380,
      total_cents: 7380,
    });

    // SAVE10 on a single 7000c arena seat
    expect(previewBreakdown(7000, 10)).toEqual({
      subtotal_cents: 7000,
      discount_cents: 700,
      fee_cents: 345,
      total_cents: 6645,
    });

    // ARENA20 on three seats
    expect(previewBreakdown(21000, 20)).toEqual({
      subtotal_cents: 21000,
      discount_cents: 4200,
      fee_cents: 870,
      total_cents: 17670,
    });
  });

  it("keeps every field an integer for awkward subtotals", () => {
    for (const subtotal of [1, 7, 33, 999, 7001, 123457]) {
      for (const percent of [0, 10, 20]) {
        const b = previewBreakdown(subtotal, percent);
        for (const value of Object.values(b)) expect(Number.isSafeInteger(value)).toBe(true);
        expect(b.total_cents).toBe(b.subtotal_cents - b.discount_cents + b.fee_cents);
      }
    }
  });
});
