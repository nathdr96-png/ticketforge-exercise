import { describe, expect, it } from "vitest";

import {
  assertCents,
  discountCents,
  feeCents,
  floorDiv,
  formatCents,
  formatMoney,
  previewBreakdown,
  sumCents,
} from "./money";

/**
 * The money path is the one place in this app where being a cent out is a bug
 * a customer notices, so it is the one place with unit tests. Everything else
 * is covered by the black-box conformance suite.
 */
describe("formatCents", () => {
  it("renders an exact two-digit minor part", () => {
    expect(formatCents(0)).toBe("0.00");
    expect(formatCents(5)).toBe("0.05");
    expect(formatCents(99)).toBe("0.99");
    expect(formatCents(100)).toBe("1.00");
    expect(formatCents(4230)).toBe("42.30");
    expect(formatCents(4282)).toBe("42.82");
  });

  it("groups thousands and keeps the sign", () => {
    expect(formatCents(123456)).toBe("1,234.56");
    expect(formatCents(100000000)).toBe("1,000,000.00");
    expect(formatCents(-4230)).toBe("-42.30");
  });

  it("never loses the trailing zero a float would", () => {
    // 1999 / 100 is 19.99 only by luck; 2010 / 100 is 20.1 and a naive
    // formatter prints "20.1" for a price.
    expect(formatCents(2010)).toBe("20.10");
    expect(formatCents(2000)).toBe("20.00");
  });

  it("prefixes the event's currency symbol", () => {
    expect(formatMoney(4230, "USD")).toBe("$42.30");
    expect(formatMoney(3705, "EUR")).toBe("€37.05");
    expect(formatMoney(4230, "ZZZ")).toBe("42.30");
  });

  it("refuses a float rather than printing a plausible wrong number", () => {
    expect(() => formatCents(42.3 as unknown as number)).toThrow(TypeError);
    expect(() => assertCents("4230")).toThrow(TypeError);
    expect(() => sumCents([100, 0.5])).toThrow(TypeError);
  });
});

describe("the contract formulas", () => {
  it("floors the discount", () => {
    expect(discountCents(3500, 10)).toBe(350);
    // 2500 * 7 / 100 = 175 exactly; 2550 * 7 / 100 = 178.5 -> 178.
    expect(discountCents(2550, 7)).toBe(178);
    expect(discountCents(4500, 10)).toBe(450);
    expect(discountCents(999, 0)).toBe(0);
  });

  it("prices the fee on the fixture subtotals", () => {
    // 4500c less SAVE10 is 4050c.
    expect(feeCents(4050)).toBe(232);
    expect(feeCents(4000)).toBe(230);
    expect(feeCents(3150)).toBe(187);
    expect(feeCents(0)).toBe(30);
  });

  it("divides once, with whole operands", () => {
    expect(floorDiv(4050 * 5, 100)).toBe(202);
  });

  it("agrees with the conformance suite's expected breakdowns", () => {
    expect(previewBreakdown(4000)).toEqual({
      subtotal_cents: 4000,
      discount_cents: 0,
      fee_cents: 230,
      total_cents: 4230,
    });
    expect(previewBreakdown(3500, 10)).toEqual({
      subtotal_cents: 3500,
      discount_cents: 350,
      fee_cents: 187,
      total_cents: 3337,
    });
    expect(previewBreakdown(4500, 10)).toEqual({
      subtotal_cents: 4500,
      discount_cents: 450,
      fee_cents: 232,
      total_cents: 4282,
    });
  });

  it("rejects a percentage that is not a whole 0..100", () => {
    expect(() => discountCents(1000, 10.5)).toThrow(RangeError);
    expect(() => discountCents(1000, -1)).toThrow(RangeError);
    expect(() => discountCents(1000, 101)).toThrow(RangeError);
  });
});
