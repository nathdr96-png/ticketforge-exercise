import { describe, expect, it } from "vitest";
import {
  ARENA,
  CLUB,
  HOLD_TTL_SECONDS,
  api,
  availableSeats,
  createHold,
  expectError,
  expectUtcIso,
  getHold,
  holdAvailableSeats,
  releaseHold,
  seatById,
  seatPage,
  tokenFor,
  type ErrorBody,
} from "./helpers.js";

/**
 * A hold is a time-limited exclusive claim on a shared resource. The two things
 * that actually matter to a buyer are that nobody else can take the seat while
 * they hold it, and that giving it up puts it back on sale. Both are tested here
 * through the public seat map, not through the hold record, because the seat map
 * is what the next buyer sees.
 */
describe("hold exclusivity", () => {
  it("refuses a second buyer the seat an active hold already claims", async () => {
    const first = await tokenFor("buyer04@ticketforge.test");
    const second = await tokenFor("buyer05@ticketforge.test");

    const { hold, seats } = await holdAvailableSeats(first, ARENA, 1);
    try {
      const conflict = await createHold(second, ARENA, [seats[0].id]);
      expectError(
        conflict,
        409,
        "SEAT_ALREADY_HELD",
        `a second buyer holding seat ${seats[0].id} while buyer04's hold ${hold.id} is active`
      );
      expect(
        (conflict.body as unknown as ErrorBody).error?.details?.seat_id,
        "the conflict must name the seat that caused it"
      ).toBe(seats[0].id);
    } finally {
      await releaseHold(first, hold.id);
    }
  });

  it("marks a held seat as held in the public seat map", async () => {
    const buyer = await tokenFor("buyer06@ticketforge.test");
    const { hold, seats } = await holdAvailableSeats(buyer, CLUB, 1);
    try {
      const seat = await seatById(buyer, CLUB, seats[0].id);
      expect(
        seat.status,
        `seat ${seats[0].id} is held by ${hold.id} but the seat map still shows it as ` +
          `${seat.status} — the next buyer would try to take it`
      ).toBe("held");
      const available = await seatPage(buyer, CLUB, { availability: "available" });
      expect(
        available.data.map((s) => s.id),
        `seat ${seats[0].id} is held but still listed as available`
      ).not.toContain(seats[0].id);
    } finally {
      await releaseHold(buyer, hold.id);
    }
  });

  it("fails a multi-seat hold as a whole when one of its seats is taken", async () => {
    const owner = await tokenFor("buyer04@ticketforge.test");
    const rival = await tokenFor("buyer05@ticketforge.test");

    const { hold, seats } = await holdAvailableSeats(owner, CLUB, 1);
    try {
      const spare = (await availableSeats(rival, CLUB, 1))[0];
      const res = await createHold(rival, CLUB, [seats[0].id, spare.id]);
      expectError(
        res,
        409,
        "SEAT_ALREADY_HELD",
        `holding [${seats[0].id} (already held), ${spare.id}]`
      );

      const after = await seatById(rival, CLUB, spare.id);
      expect(
        after.status,
        `the rejected hold left seat ${spare.id} as ${after.status} — a hold that fails ` +
          `must claim none of its seats, or that seat is lost to everyone`
      ).toBe("available");
    } finally {
      await releaseHold(owner, hold.id);
    }
  });
});

describe("hold lifecycle", () => {
  it("creates a hold with the contract's TTL and a readable record", async () => {
    const buyer = await tokenFor("buyer04@ticketforge.test");
    const { hold, seats } = await holdAvailableSeats(buyer, ARENA, 2);
    try {
      expect(hold.status, "a new hold starts active").toBe("active");
      expect(hold.event_id, "a hold must report its event").toBe(ARENA);
      expect([...hold.seat_ids].sort(), "a hold must report the seats it claims").toEqual(
        seats.map((s) => s.id).sort()
      );
      expectUtcIso(hold.created_at, "hold created_at");
      expectUtcIso(hold.expires_at, "hold expires_at");

      const ttlSeconds =
        (new Date(hold.expires_at).getTime() - new Date(hold.created_at).getTime()) / 1000;
      expect(
        Math.abs(ttlSeconds - HOLD_TTL_SECONDS),
        `hold ${hold.id} expires ${ttlSeconds}s after creation; the contract's TTL is ` +
          `${HOLD_TTL_SECONDS}s`
      ).toBeLessThanOrEqual(10);

      const fetched = await getHold(buyer, hold.id);
      expect(fetched.status, `GET /holds/${hold.id} by its owner should be 200`).toBe(200);
      expect(fetched.body.id, "the fetched hold must be the one created").toBe(hold.id);
      expect(fetched.body.status, "a hold within its TTL is still active").toBe("active");
    } finally {
      await releaseHold(buyer, hold.id);
    }
  });

  it("returns the seats to the pool when a hold is released", async () => {
    const owner = await tokenFor("buyer04@ticketforge.test");
    const next = await tokenFor("buyer05@ticketforge.test");

    const availableBefore = (await seatPage(owner, CLUB, { availability: "available" })).total;
    const { hold, seats } = await holdAvailableSeats(owner, CLUB, 1);
    const seatId = seats[0].id;

    const released = await releaseHold(owner, hold.id);
    expect(
      released.status,
      `DELETE /holds/${hold.id} by its owner should be 204, got ${released.status}`
    ).toBe(204);

    const seat = await seatById(next, CLUB, seatId);
    expect(
      seat.status,
      `seat ${seatId} is still ${seat.status} after its hold was released — ` +
        `a released seat must go back on sale`
    ).toBe("available");

    const availableAfter = (await seatPage(next, CLUB, { availability: "available" })).total;
    expect(
      availableAfter,
      `${CLUB} had ${availableBefore} seats available before a hold-then-release cycle and ` +
        `${availableAfter} after — releasing must leave the inventory where it started`
    ).toBe(availableBefore);

    const reheld = await createHold(next, CLUB, [seatId]);
    expect(
      reheld.status,
      `another buyer could not hold the released seat ${seatId}: ${reheld.status} ` +
        `${reheld.text.slice(0, 200)}`
    ).toBe(201);
    await releaseHold(next, reheld.body.id);
  });

  it("returns every seat of a multi-seat hold, not just one of them", async () => {
    const owner = await tokenFor("buyer04@ticketforge.test");
    const { hold, seats } = await holdAvailableSeats(owner, ARENA, 3);
    expect((await releaseHold(owner, hold.id)).status, "the release should be 204").toBe(204);

    const stuck: string[] = [];
    for (const held of seats) {
      const seat = await seatById(owner, ARENA, held.id);
      if (seat.status !== "available") stuck.push(`${held.id}=${seat.status}`);
    }
    expect(
      stuck,
      `hold ${hold.id} covered ${seats.length} seats and releasing it left ${stuck.length} ` +
        `behind (${stuck.join(", ")}) — a partial release strands inventory nobody can buy`
    ).toEqual([]);
  });

  it("reports a released hold as released rather than hiding it", async () => {
    const buyer = await tokenFor("buyer04@ticketforge.test");
    const { hold } = await holdAvailableSeats(buyer, ARENA, 1);
    await releaseHold(buyer, hold.id);

    const fetched = await getHold(buyer, hold.id);
    expect(
      fetched.status,
      `GET /holds/${hold.id} after release should still be 200 — the record exists and its ` +
        `state is the answer`
    ).toBe(200);
    expect(fetched.body.status, "a released hold reports status released").toBe("released");
  });

  it("refuses to release the same hold twice", async () => {
    const buyer = await tokenFor("buyer04@ticketforge.test");
    const { hold } = await holdAvailableSeats(buyer, ARENA, 1);
    expect((await releaseHold(buyer, hold.id)).status, "the first release succeeds").toBe(204);
    expectError(
      await releaseHold(buyer, hold.id),
      410,
      "HOLD_EXPIRED",
      `releasing hold ${hold.id} a second time`
    );
  });
});

describe("hold ownership", () => {
  it("keeps one buyer from releasing another buyer's hold", async () => {
    const owner = await tokenFor("buyer04@ticketforge.test");
    const stranger = await tokenFor("buyer05@ticketforge.test");
    const { hold, seats } = await holdAvailableSeats(owner, ARENA, 1);
    try {
      expectError(
        await releaseHold(stranger, hold.id),
        403,
        "INSUFFICIENT_PERMISSION",
        `a stranger releasing hold ${hold.id}`
      );
      const seat = await seatById(owner, ARENA, seats[0].id);
      expect(
        seat.status,
        `the refused release still freed seat ${seats[0].id} — the refusal must change nothing`
      ).toBe("held");
    } finally {
      await releaseHold(owner, hold.id);
    }
  });

  it("keeps one buyer from reading another buyer's hold", async () => {
    const owner = await tokenFor("buyer04@ticketforge.test");
    const stranger = await tokenFor("buyer05@ticketforge.test");
    const { hold } = await holdAvailableSeats(owner, ARENA, 1);
    try {
      expectError(
        await getHold(stranger, hold.id),
        403,
        "INSUFFICIENT_PERMISSION",
        `a stranger reading hold ${hold.id}`
      );
    } finally {
      await releaseHold(owner, hold.id);
    }
  });

  it("lets an admin read any hold", async () => {
    const owner = await tokenFor("buyer04@ticketforge.test");
    const admin = await tokenFor("admin@ticketforge.test");
    const { hold } = await holdAvailableSeats(owner, ARENA, 1);
    try {
      const res = await getHold(admin, hold.id);
      expect(res.status, `an admin reading hold ${hold.id} should be 200`).toBe(200);
      expect(res.body.id, "the admin must see the hold that was created").toBe(hold.id);
    } finally {
      await releaseHold(owner, hold.id);
    }
  });
});

describe("hold validation", () => {
  it("reports an unknown seat as not found", async () => {
    const buyer = await tokenFor("buyer06@ticketforge.test");
    expectError(
      await createHold(buyer, CLUB, ["seat_does_not_exist"]),
      404,
      "SEAT_NOT_FOUND",
      "holding a seat id that does not exist"
    );
  });

  it("refuses a seat that belongs to a different event", async () => {
    const buyer = await tokenFor("buyer06@ticketforge.test");
    const arenaSeat = (await availableSeats(buyer, ARENA, 1))[0];
    expectError(
      await createHold(buyer, CLUB, [arenaSeat.id]),
      400,
      "VALIDATION_ERROR",
      `holding arena seat ${arenaSeat.id} against ${CLUB}`
    );
  });

  it("refuses an empty seat list", async () => {
    const buyer = await tokenFor("buyer06@ticketforge.test");
    expectError(
      await createHold(buyer, CLUB, []),
      400,
      "VALIDATION_ERROR",
      "holding an empty seat list"
    );
  });

  it("reports an unknown hold as not found", async () => {
    const buyer = await tokenFor("buyer06@ticketforge.test");
    expectError(
      await api("/holds/hold_does_not_exist", { token: buyer }),
      404,
      "HOLD_NOT_FOUND",
      "reading a hold id that does not exist"
    );
  });
});
