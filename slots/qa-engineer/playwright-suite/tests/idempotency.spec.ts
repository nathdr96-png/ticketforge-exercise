import { describe, expect, it } from "vitest";
import {
  ARENA,
  CLUB,
  api,
  expectError,
  holdAvailableSeats,
  idempotencyKey,
  placeOrder,
  seatById,
  tokenFor,
  type ErrorBody,
  type Order,
  type Res,
} from "./helpers.js";

/**
 * Idempotency exists because a buyer's phone retries a request we already
 * processed. Two failure modes matter, and they pull in opposite directions:
 * charging twice for one intent, and silently returning the wrong order for a
 * retry that is not actually the same request.
 */
describe("idempotency key handling", () => {
  it("refuses an order with no idempotency key", async () => {
    const buyer = await tokenFor("buyer10@ticketforge.test");
    const { hold } = await holdAvailableSeats(buyer, ARENA, 1);
    try {
      const res = await api("/orders", {
        method: "POST",
        token: buyer,
        body: JSON.stringify({ hold_id: hold.id }),
      });
      expectError(
        res,
        400,
        "IDEMPOTENCY_KEY_REQUIRED",
        "POST /orders with no Idempotency-Key header"
      );
    } finally {
      await api(`/holds/${hold.id}`, { method: "DELETE", token: buyer });
    }
  });

  it("refuses an idempotency key shorter than the contract allows", async () => {
    const buyer = await tokenFor("buyer10@ticketforge.test");
    const { hold } = await holdAvailableSeats(buyer, ARENA, 1);
    try {
      const res = await placeOrder(buyer, { hold_id: hold.id }, "short");
      // The contract sets a minimum length of 8 but does not pin which of the two
      // 400 codes a too-short key earns, so accept either rather than inventing a
      // rule the contract does not state.
      expect(res.status, "a 5-character idempotency key must be refused").toBe(400);
      expect(
        ["IDEMPOTENCY_KEY_REQUIRED", "VALIDATION_ERROR"],
        `a too-short key returned ${(res.body as unknown as ErrorBody).error?.code}`
      ).toContain((res.body as unknown as ErrorBody).error?.code);
    } finally {
      await api(`/holds/${hold.id}`, { method: "DELETE", token: buyer });
    }
  });

  it("replays the first order when the same key and body come back", async () => {
    const buyer = await tokenFor("buyer10@ticketforge.test");
    const { hold } = await holdAvailableSeats(buyer, CLUB, 1);
    const key = idempotencyKey("replay");
    const body = { hold_id: hold.id };

    const first = await placeOrder(buyer, body, key);
    expect(first.status, `the first order should be 201, got ${first.text.slice(0, 200)}`).toBe(201);

    const replay = await placeOrder(buyer, body, key);
    expect(
      replay.status,
      `a retry of an identical request must be 200 (replay), not ${replay.status} — ` +
        `201 would mean a second order was created`
    ).toBe(200);
    expect(
      replay.body.id,
      `the retry returned order ${replay.body.id}, but the original was ${first.body.id}`
    ).toBe(first.body.id);
    expect(
      {
        subtotal: replay.body.subtotal_cents,
        fee: replay.body.fee_cents,
        total: replay.body.total_cents,
      },
      "a replayed order must be identical, not re-priced"
    ).toEqual({
      subtotal: first.body.subtotal_cents,
      fee: first.body.fee_cents,
      total: first.body.total_cents,
    });
  });

  it("conflicts when a key is reused with a changed body", async () => {
    const buyer = await tokenFor("buyer10@ticketforge.test");
    const { hold } = await holdAvailableSeats(buyer, CLUB, 1);
    const key = idempotencyKey("mutated");

    const first = await placeOrder(buyer, { hold_id: hold.id }, key);
    expect(first.status, `the first order should be 201, got ${first.text.slice(0, 200)}`).toBe(201);

    const mutated: Res<Order | ErrorBody> = await placeOrder(
      buyer,
      { hold_id: hold.id, discount_code: "SAVE10" },
      key
    );
    expectError(
      mutated as Res<unknown>,
      409,
      "IDEMPOTENCY_KEY_CONFLICT",
      `key ${key} reused with a discount code added — a different request, not a retry`
    );
    expect(
      (mutated.body as Order).total_cents,
      "a conflicting retry must not quietly hand back the earlier order"
    ).toBeUndefined();
  });

  it("conflicts when a key is reused against a different hold", async () => {
    const buyer = await tokenFor("buyer10@ticketforge.test");
    const first = await holdAvailableSeats(buyer, CLUB, 1);
    const second = await holdAvailableSeats(buyer, CLUB, 1);
    const key = idempotencyKey("rebound");

    const bought = await placeOrder(buyer, { hold_id: first.hold.id }, key);
    expect(bought.status, `the first order should be 201, got ${bought.text.slice(0, 200)}`).toBe(
      201
    );

    const reused = await placeOrder(buyer, { hold_id: second.hold.id }, key);
    expectError(
      reused as Res<unknown>,
      409,
      "IDEMPOTENCY_KEY_CONFLICT",
      `key ${key} reused against hold ${second.hold.id}`
    );

    const seat = await seatById(buyer, CLUB, second.seats[0].id);
    expect(
      seat.status,
      `seat ${second.seats[0].id} is ${seat.status} — the conflicting request must not have ` +
        `sold it, and returning the earlier order would strand it held forever`
    ).toBe("held");
    await api(`/holds/${second.hold.id}`, { method: "DELETE", token: buyer });
  });

  it("scopes an idempotency key to the buyer who used it", async () => {
    const one = await tokenFor("buyer10@ticketforge.test");
    const two = await tokenFor("buyer11@ticketforge.test");
    const shared = idempotencyKey("shared-between-buyers");

    const holdOne = await holdAvailableSeats(one, ARENA, 1);
    const firstBuy = await placeOrder(one, { hold_id: holdOne.hold.id }, shared);
    expect(firstBuy.status, "the first buyer's order should be 201").toBe(201);

    const holdTwo = await holdAvailableSeats(two, ARENA, 1);
    const secondBuy = await placeOrder(two, { hold_id: holdTwo.hold.id }, shared);
    expect(
      secondBuy.status,
      `the second buyer reused the key string "${shared}" and got ${secondBuy.status}: ` +
        `${secondBuy.text.slice(0, 200)} — keys are scoped per buyer, so this is a new order`
    ).toBe(201);
    expect(
      secondBuy.body.id,
      "two buyers using the same key string must get two distinct orders"
    ).not.toBe(firstBuy.body.id);
  });
});
