import { describe, expect, it } from "vitest";
import {
  ARENA,
  CLUB,
  FEE_FIXED_CENTS,
  FEE_PERCENT,
  api,
  buySeats,
  expectError,
  expectIntegerCents,
  expectUtcIso,
  expectedDiscountCents,
  expectedFeeCents,
  holdAvailableSeats,
  getHold,
  placeOrder,
  seatById,
  tokenFor,
} from "./helpers.js";

const MONEY_FIELDS = ["subtotal_cents", "fee_cents", "discount_cents", "total_cents"];

describe("order pricing", () => {
  it("prices an undiscounted order as the seat total plus the booking fee", async () => {
    const buyer = await tokenFor("buyer07@ticketforge.test");
    const { order, seats } = await buySeats(buyer, ARENA, { count: 2 });

    const subtotal = seats.reduce((sum, s) => sum + s.price_cents, 0);
    expectIntegerCents(order as unknown as Record<string, unknown>, MONEY_FIELDS, `order ${order.id}`);
    expect(
      order.subtotal_cents,
      `order ${order.id} covers seats priced ${seats
        .map((s) => s.price_cents)
        .join(" + ")} = ${subtotal}c, but reports a subtotal of ${order.subtotal_cents}c`
    ).toBe(subtotal);
    expect(order.discount_cents, "an order with no discount code gives nothing away").toBe(0);
    expect(order.discount_code, "an order with no discount code records none").toBeNull();
    expect(
      order.fee_cents,
      `fee on ${subtotal}c should be floor(${subtotal} × ${FEE_PERCENT}%) + ` +
        `${FEE_FIXED_CENTS} = ${expectedFeeCents(subtotal)}c, got ${order.fee_cents}c`
    ).toBe(expectedFeeCents(subtotal));
    expect(
      order.total_cents,
      `total must be subtotal − discount + fee = ${subtotal} − 0 + ${order.fee_cents}`
    ).toBe(subtotal + order.fee_cents);
    expect(order.currency, `${ARENA} is priced in USD`).toBe("USD");
    expect(order.status, "a completed order is paid").toBe("paid");
    expectUtcIso(order.created_at, `order ${order.id} created_at`);
  });

  it("charges a booking fee on a discounted order", async () => {
    const buyer = await tokenFor("buyer07@ticketforge.test");
    const { order, seats } = await buySeats(buyer, CLUB, {
      priceCents: 2500,
      discountCode: "SAVE10",
    });

    const subtotal = seats[0].price_cents;
    expect(order.subtotal_cents, `the ${CLUB} seat is priced ${subtotal}c`).toBe(subtotal);
    expect(
      order.discount_cents,
      `SAVE10 on ${subtotal}c is ${expectedDiscountCents(subtotal, 10)}c`
    ).toBe(expectedDiscountCents(subtotal, 10));
    expect(typeof order.fee_cents, "a discounted order still carries a booking fee").toBe("number");
    expect(order.fee_cents, "the booking fee must be positive").toBeGreaterThan(0);
    expect(typeof order.total_cents, "the order must quote a total").toBe("number");
  });

  it("charges the booking fee on the discounted subtotal, not the face value", async () => {
    const buyer = await tokenFor("buyer07@ticketforge.test");
    const { order, seats } = await buySeats(buyer, ARENA, { count: 2, discountCode: "SAVE10" });

    const subtotal = seats.reduce((sum, s) => sum + s.price_cents, 0);
    const discount = expectedDiscountCents(subtotal, 10);
    const afterDiscount = subtotal - discount;
    expect(order.subtotal_cents, "the subtotal is the seat face value").toBe(subtotal);
    expect(order.discount_cents, `SAVE10 on ${subtotal}c is ${discount}c`).toBe(discount);
    expect(
      order.fee_cents,
      `fee is charged on the discounted subtotal ${afterDiscount}c ` +
        `(${expectedFeeCents(afterDiscount)}c), not on the face value ${subtotal}c ` +
        `(${expectedFeeCents(subtotal)}c); got ${order.fee_cents}c`
    ).toBe(expectedFeeCents(afterDiscount));
    expect(
      order.total_cents,
      `charging the fee before the discount would overcharge this buyer by ` +
        `${expectedFeeCents(subtotal) - expectedFeeCents(afterDiscount)}c`
    ).toBe(afterDiscount + expectedFeeCents(afterDiscount));
  });

  it("serializes every money field as an integer, never a decimal", async () => {
    const buyer = await tokenFor("buyer07@ticketforge.test");
    const { hold } = await holdAvailableSeats(buyer, ARENA, 1);
    const res = await placeOrder(buyer, { hold_id: hold.id, discount_code: "SAVE10" });
    expect(res.status, `POST /orders should be 201, got ${res.status}`).toBe(201);

    for (const field of MONEY_FIELDS) {
      const decimal = new RegExp(`"${field}"\\s*:\\s*-?\\d+\\.\\d+`).exec(res.text);
      expect(
        decimal?.[0] ?? null,
        `${field} was serialized as a decimal (${decimal?.[0]}) — money travels as integer ` +
          `minor units, and a float here means a float somewhere in the pricing path`
      ).toBeNull();
    }
    expectIntegerCents(
      res.body as unknown as Record<string, unknown>,
      MONEY_FIELDS,
      `order ${res.body.id}`
    );
  });
});

describe("order fulfilment", () => {
  it("sells the held seats and converts the hold", async () => {
    const buyer = await tokenFor("buyer07@ticketforge.test");
    const { hold, seats } = await holdAvailableSeats(buyer, CLUB, 1);
    const res = await placeOrder(buyer, { hold_id: hold.id });
    expect(res.status, `POST /orders should be 201, got ${res.text.slice(0, 200)}`).toBe(201);

    expect([...res.body.seat_ids].sort(), "the order must carry the hold's seats").toEqual(
      seats.map((s) => s.id).sort()
    );
    expect(res.body.hold_id, "the order must reference the hold it converted").toBe(hold.id);

    const seat = await seatById(buyer, CLUB, seats[0].id);
    expect(
      seat.status,
      `seat ${seats[0].id} was paid for but the seat map still shows it as ${seat.status}`
    ).toBe("sold");

    const after = await getHold(buyer, hold.id);
    expect(after.status, `GET /holds/${hold.id} after purchase should be 200`).toBe(200);
    expect(after.body.status, "a purchased hold is converted").toBe("converted");
  });

  it("refuses to sell the same hold twice", async () => {
    const buyer = await tokenFor("buyer07@ticketforge.test");
    const { hold } = await holdAvailableSeats(buyer, CLUB, 1);
    expect((await placeOrder(buyer, { hold_id: hold.id })).status, "the first sale succeeds").toBe(
      201
    );
    // A different idempotency key: this is a second request, not a retry.
    expectError(
      await placeOrder(buyer, { hold_id: hold.id }),
      409,
      "HOLD_ALREADY_CONVERTED",
      `a second order against the already-converted hold ${hold.id}`
    );
  });

  it("refuses to sell a hold that was released", async () => {
    const buyer = await tokenFor("buyer07@ticketforge.test");
    const { hold } = await holdAvailableSeats(buyer, ARENA, 1);
    await api(`/holds/${hold.id}`, { method: "DELETE", token: buyer });
    expectError(
      await placeOrder(buyer, { hold_id: hold.id }),
      410,
      "HOLD_EXPIRED",
      `an order against the released hold ${hold.id}`
    );
  });

  it("refuses to sell another buyer's hold", async () => {
    const owner = await tokenFor("buyer07@ticketforge.test");
    const stranger = await tokenFor("buyer08@ticketforge.test");
    const { hold } = await holdAvailableSeats(owner, ARENA, 1);
    try {
      expectError(
        await placeOrder(stranger, { hold_id: hold.id }),
        403,
        "INSUFFICIENT_PERMISSION",
        `a stranger buying hold ${hold.id}`
      );
    } finally {
      await api(`/holds/${hold.id}`, { method: "DELETE", token: owner });
    }
  });

  it("reports an unknown hold as not found", async () => {
    const buyer = await tokenFor("buyer07@ticketforge.test");
    expectError(
      await placeOrder(buyer, { hold_id: "hold_does_not_exist" }),
      404,
      "HOLD_NOT_FOUND",
      "an order against a hold id that does not exist"
    );
  });
});

describe("order visibility", () => {
  it("shows an order to its buyer, its organizer and an admin — and nobody else", async () => {
    const buyer = await tokenFor("buyer07@ticketforge.test");
    const { order } = await buySeats(buyer, CLUB, {});

    const allowed: [string, string][] = [
      ["its buyer", buyer],
      ["the event's organizer", await tokenFor("org1@ticketforge.test")],
      ["an admin", await tokenFor("admin@ticketforge.test")],
    ];
    for (const [who, token] of allowed) {
      const res = await api(`/orders/${order.id}`, { token });
      expect(res.status, `${who} should be able to read order ${order.id}`).toBe(200);
    }

    const denied: [string, string][] = [
      ["another buyer", await tokenFor("buyer08@ticketforge.test")],
      ["another organizer", await tokenFor("org2@ticketforge.test")],
    ];
    for (const [who, token] of denied) {
      expectError(
        await api(`/orders/${order.id}`, { token }),
        403,
        "INSUFFICIENT_PERMISSION",
        `${who} reading order ${order.id}`
      );
    }
  });

  it("reports an unknown order as not found", async () => {
    const buyer = await tokenFor("buyer07@ticketforge.test");
    expectError(
      await api("/orders/ord_does_not_exist", { token: buyer }),
      404,
      "ORDER_NOT_FOUND",
      "reading an order id that does not exist"
    );
  });
});
