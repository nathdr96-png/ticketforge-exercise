import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeDiscountCents, computeFeeCents } from "../src/config.js";

describe("money math", () => {
  it("computes fee as floor(subtotal * 5/100) + 30", () => {
    assert.equal(computeFeeCents(5000), 280);
    assert.equal(computeFeeCents(0), 30);
    assert.equal(computeFeeCents(99), 34);
  });

  it("computes discount without floats in result", () => {
    assert.equal(computeDiscountCents(5000, 10), 500);
    assert.equal(computeDiscountCents(3333, 10), 333);
    assert.equal(Number.isInteger(computeDiscountCents(1111, 15)), true);
  });

  it("order total identity", () => {
    const subtotal = 7500;
    const discount = computeDiscountCents(subtotal, 10);
    const fee = computeFeeCents(subtotal - discount);
    const total = subtotal - discount + fee;
    assert.equal(total, 6750 + computeFeeCents(6750));
    assert.equal(Number.isInteger(total), true);
  });
});
