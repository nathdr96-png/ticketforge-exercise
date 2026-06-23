import { describe, expect, it } from "vitest";

import {
  assertCents,
  discountCents,
  divFloor,
  feeCents,
  formatCents,
  formatMoney,
  previewBreakdown,
  sumCents,
} from "./money";

describe("formatCents", () => {
  it("keeps both minor digits", () => {
    expect(formatCents(0)).toBe("0.00");
    expect(formatCents(5)).toBe("0.05");
    expect(formatCents(70)).toBe("0.70");
    expect(formatCents(4230)).toBe("42.30");
    expect(formatCents(4282)).toBe("42.82");
    expect(formatCents(7001)).toBe("70.01");
  });

  it("groups thousands and keeps a leading minus", () => {
    expect(formatCents(123456)).toBe("1,234.56");
    expect(formatCents(100000000)).toBe("1,000,000.00");
    expect(formatCents(-4230)).toBe("-42.30");
  });

  it("refuses anything that is not integer cents", () => {
    expect(() => formatCents(42.3)).toThrow(TypeError);
    expect(() => assertCents("4230")).toThrow(TypeError);
    expect(() => sumCents([100, 1.5])).toThrow(TypeError);
  });

  it("prefixes the event's currency symbol", () => {
    expect(formatMoney(4230, "EUR")).toBe("€42.30");
    expect(formatMoney(2500, "USD")).toBe("$25.00");
  });
});

describe("contract/scenarios/T3-orders-money.md arithmetic", () => {
  it("floors the discount", () => {
    expect(discountCents(3500, 10)).toBe(350);
    expect(discountCents(4500, 10)).toBe(450);
    // 7001 * 10 / 100 = 700.1 -> 700, never 701.
    expect(discountCents(7001, 10)).toBe(700);
    expect(discountCents(4000, 0)).toBe(0);
  });

  it("prices the fee on the fixture subtotals", () => {
    expect(feeCents(4000)).toBe(230);
    expect(feeCents(3150)).toBe(187);
    expect(feeCents(4050)).toBe(232);
    expect(divFloor(4050 * 5, 100)).toBe(202);
  });

  it("charges the fee on the post-discount subtotal", () => {
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

  it("shows nothing at all for an empty selection", () => {
    expect(previewBreakdown(0)).toEqual({
      subtotal_cents: 0,
      discount_cents: 0,
      fee_cents: 0,
      total_cents: 0,
    });
  });

  it("sums seat prices as integers", () => {
    expect(sumCents([7000, 6000, 5000, 4500])).toBe(22500);
    expect(sumCents([])).toBe(0);
  });

  it("rejects a percentage outside 0..100", () => {
    expect(() => discountCents(4000, 101)).toThrow(RangeError);
    expect(() => discountCents(4000, 10.5)).toThrow(RangeError);
  });
});
