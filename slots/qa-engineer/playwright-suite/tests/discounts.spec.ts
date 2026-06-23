import { describe, expect, it } from "vitest";
import {
  ARENA,
  CLUB,
  api,
  buySeats,
  expectError,
  expectedDiscountCents,
  getHold,
  holdAvailableSeats,
  placeOrder,
  seatById,
  tokenFor,
} from "./helpers.js";

/**
 * Discount behaviour is asserted through the order the buyer ends up with: how
 * much was taken off, which code was recorded, and — for a code that does not
 * apply — that nothing was sold at all. These tests deliberately do not assert
 * the exact fee; that is the fee tests' job, and duplicating it here would make
 * one pricing change fail five tests for the same reason.
 */
describe("discount codes", () => {
  it("takes a flat percentage off the subtotal, floored", async () => {
    const buyer = await tokenFor("buyer09@ticketforge.test");
    const { order, seats } = await buySeats(buyer, ARENA, { discountCode: "SAVE10" });

    const subtotal = seats[0].price_cents;
    const discount = expectedDiscountCents(subtotal, 10);
    expect(order.subtotal_cents, "the subtotal stays the seat face value").toBe(subtotal);
    expect(
      order.discount_cents,
      `SAVE10 on ${subtotal}c should take off floor(${subtotal} × 10 / 100) = ${discount}c, ` +
        `got ${order.discount_cents}c`
    ).toBe(discount);
    expect(order.discount_code, "the order must record the code that was applied").toBe("SAVE10");
    expect(
      order.total_cents,
      `total must reconcile: subtotal ${order.subtotal_cents} − discount ${order.discount_cents} ` +
        `+ fee ${order.fee_cents}`
    ).toBe(order.subtotal_cents - order.discount_cents + order.fee_cents);
  });

  it("applies an event-scoped code to the event it belongs to", async () => {
    const buyer = await tokenFor("buyer09@ticketforge.test");
    const { order, seats } = await buySeats(buyer, ARENA, { discountCode: "ARENA20" });

    const subtotal = seats[0].price_cents;
    expect(
      order.discount_cents,
      `ARENA20 is a 20% code and ${ARENA} is its event, so ${subtotal}c should lose ` +
        `${expectedDiscountCents(subtotal, 20)}c`
    ).toBe(expectedDiscountCents(subtotal, 20));
    expect(order.discount_code, "the order must record ARENA20").toBe("ARENA20");
  });

  it("refuses an event-scoped code on a different event", async () => {
    const buyer = await tokenFor("buyer09@ticketforge.test");
    const { hold } = await holdAvailableSeats(buyer, CLUB, 1);
    try {
      expectError(
        await placeOrder(buyer, { hold_id: hold.id, discount_code: "ARENA20" }),
        400,
        "DISCOUNT_INVALID",
        `ARENA20 (scoped to ${ARENA}) used on ${CLUB}`
      );
    } finally {
      await api(`/holds/${hold.id}`, { method: "DELETE", token: buyer });
    }
  });

  it("refuses a code that does not exist", async () => {
    const buyer = await tokenFor("buyer09@ticketforge.test");
    const { hold } = await holdAvailableSeats(buyer, ARENA, 1);
    try {
      expectError(
        await placeOrder(buyer, { hold_id: hold.id, discount_code: "NOT-A-CODE" }),
        400,
        "DISCOUNT_INVALID",
        "an unknown discount code"
      );
    } finally {
      await api(`/holds/${hold.id}`, { method: "DELETE", token: buyer });
    }
  });

  it("refuses a code that is no longer active", async () => {
    const buyer = await tokenFor("buyer09@ticketforge.test");
    const { hold } = await holdAvailableSeats(buyer, ARENA, 1);
    try {
      expectError(
        await placeOrder(buyer, { hold_id: hold.id, discount_code: "EXPIRED0" }),
        400,
        "DISCOUNT_INVALID",
        "EXPIRED0, which the fixtures mark inactive"
      );
    } finally {
      await api(`/holds/${hold.id}`, { method: "DELETE", token: buyer });
    }
  });

  it("sells nothing when the discount is refused", async () => {
    const buyer = await tokenFor("buyer09@ticketforge.test");
    const { hold, seats } = await holdAvailableSeats(buyer, CLUB, 1);
    try {
      const refused = await placeOrder(buyer, { hold_id: hold.id, discount_code: "NOT-A-CODE" });
      expect(refused.status, "a bad discount code must not produce an order").toBe(400);

      const seat = await seatById(buyer, CLUB, seats[0].id);
      expect(
        seat.status,
        `seat ${seats[0].id} became ${seat.status} even though the order was refused — ` +
          `a rejected order must leave the seat held, not sold`
      ).toBe("held");

      const after = await getHold(buyer, hold.id);
      expect(
        after.body.status,
        `hold ${hold.id} is ${after.body.status} after a refused order — the buyer must be ` +
          `able to retry with a valid code`
      ).toBe("active");

      const retried = await placeOrder(buyer, { hold_id: hold.id });
      expect(
        retried.status,
        `retrying without a discount code should succeed, got ${retried.status}: ` +
          `${retried.text.slice(0, 200)}`
      ).toBe(201);
    } finally {
      await api(`/holds/${hold.id}`, { method: "DELETE", token: buyer });
    }
  });
});
