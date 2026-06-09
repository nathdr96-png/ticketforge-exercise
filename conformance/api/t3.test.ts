import { describe, expect, it } from "vitest";
import { api, assertIntegerCents, login } from "./helpers.js";

function fee(subtotalAfterDiscount: number) {
  return Math.floor((subtotalAfterDiscount * 5) / 100) + 30;
}

describe("T3 orders + money + idempotency", () => {
  it("convert hold with correct money math and idempotent replay", async () => {
    const { token } = await login("buyer05@ticketforge.test");
    const seats = await api<{ data: { id: string; price_cents: number }[] }>(
      "/events/event_arena_2000/seats?availability=available&page=1&page_size=1",
      { token }
    );
    const seat = seats.body.data[0];
    const hold = await api<{ id: string }>("/holds", {
      method: "POST",
      token,
      body: JSON.stringify({ event_id: "event_arena_2000", seat_ids: [seat.id] }),
    });
    expect(hold.status).toBe(201);

    const key = `idem-buyer05-${Date.now()}`;
    const body = { hold_id: hold.body.id };
    const order = await api<Record<string, unknown>>("/orders", {
      method: "POST",
      token,
      headers: { "Idempotency-Key": key },
      body: JSON.stringify(body),
    });
    expect(order.status).toBe(201);
    assertIntegerCents(order.body, [
      "subtotal_cents",
      "fee_cents",
      "discount_cents",
      "total_cents",
    ]);
    expect(order.body.subtotal_cents).toBe(seat.price_cents);
    expect(order.body.discount_cents).toBe(0);
    expect(order.body.fee_cents).toBe(fee(seat.price_cents));
    expect(order.body.total_cents).toBe(seat.price_cents + fee(seat.price_cents));

    const replay = await api<Record<string, unknown>>("/orders", {
      method: "POST",
      token,
      headers: { "Idempotency-Key": key },
      body: JSON.stringify(body),
    });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(order.body.id);

    const conflict = await api<{ error: { code: string } }>("/orders", {
      method: "POST",
      token,
      headers: { "Idempotency-Key": key },
      body: JSON.stringify({ hold_id: hold.body.id, discount_code: "SAVE10" }),
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
  });

  it("missing idempotency key", async () => {
    const { token } = await login("buyer06@ticketforge.test");
    const { status, body } = await api<{ error: { code: string } }>("/orders", {
      method: "POST",
      token,
      body: JSON.stringify({ hold_id: "hold_missing" }),
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("discount SAVE10", async () => {
    const { token } = await login("buyer07@ticketforge.test");
    const seats = await api<{ data: { id: string; price_cents: number }[] }>(
      "/events/event_arena_2000/seats?availability=available&page=1&page_size=1",
      { token }
    );
    const seat = seats.body.data[0];
    const hold = await api<{ id: string }>("/holds", {
      method: "POST",
      token,
      body: JSON.stringify({ event_id: "event_arena_2000", seat_ids: [seat.id] }),
    });
    const order = await api<Record<string, number>>("/orders", {
      method: "POST",
      token,
      headers: { "Idempotency-Key": `idem-disc-${Date.now()}` },
      body: JSON.stringify({ hold_id: hold.body.id, discount_code: "SAVE10" }),
    });
    expect(order.status).toBe(201);
    const discount = Math.floor((seat.price_cents * 10) / 100);
    expect(order.body.discount_cents).toBe(discount);
    expect(order.body.fee_cents).toBe(fee(seat.price_cents - discount));
    expect(order.body.total_cents).toBe(seat.price_cents - discount + order.body.fee_cents);
  });

  it("invalid discount", async () => {
    const { token } = await login("buyer08@ticketforge.test");
    const seats = await api<{ data: { id: string }[] }>(
      "/events/event_arena_2000/seats?availability=available&page=1&page_size=1",
      { token }
    );
    const hold = await api<{ id: string }>("/holds", {
      method: "POST",
      token,
      body: JSON.stringify({
        event_id: "event_arena_2000",
        seat_ids: [seats.body.data[0].id],
      }),
    });
    const { status, body } = await api<{ error: { code: string } }>("/orders", {
      method: "POST",
      token,
      headers: { "Idempotency-Key": `idem-bad-${Date.now()}` },
      body: JSON.stringify({ hold_id: hold.body.id, discount_code: "NOPE" }),
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe("DISCOUNT_INVALID");
  });
});
