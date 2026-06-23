import { beforeAll, describe, expect, it } from "vitest";
import {
  ARENA,
  api,
  expectError,
  getEvent,
  seatPage,
  type Page,
  type Seat,
  tokenFor,
} from "./helpers.js";

let token: string;

/**
 * Seat prices come from the fixtures: `base_price_cents` plus the section delta
 * declared in `contract/seed/seed.json`. Asserting them keeps a pricing change
 * from silently reaching buyers.
 */
const SECTION_SIZE = 500;
const SECTION_PRICES: Record<string, number> = { A: 7000, B: 6000, C: 5000, D: 4500 };

beforeAll(async () => {
  token = await tokenFor("buyer03@ticketforge.test");
});

describe("seat map filtering", () => {
  it("returns a section's seats, and only that section's seats", async () => {
    for (const section of Object.keys(SECTION_PRICES)) {
      const body = await seatPage(token, ARENA, { section });
      expect(
        body.total,
        `section=${section} reported ${body.total} seats — each arena section seeds ` +
          `${SECTION_SIZE} seats (25 rows × 20), independently of what is still available`
      ).toBe(SECTION_SIZE);
      expect(
        body.data.length,
        `section=${section} returned no seats at all, though it reports ${body.total}`
      ).toBeGreaterThan(0);
      const strays = [...new Set(body.data.map((s) => s.section))].filter((s) => s !== section);
      expect(strays, `section=${section} also returned seats from section(s) ${strays}`).toEqual([]);
    }
  });

  it("partitions the event: the sections add up to the whole seat map", async () => {
    const event = await getEvent(token, ARENA);
    const totals: Record<string, number> = {};
    for (const section of Object.keys(SECTION_PRICES)) {
      totals[section] = (await seatPage(token, ARENA, { section })).total;
    }
    const summed = Object.values(totals).reduce((a, b) => a + b, 0);
    expect(
      summed,
      `the per-section totals ${JSON.stringify(totals)} add up to ${summed}, but the event ` +
        `declares ${event.seat_count} seats — every seat belongs to exactly one section`
    ).toBe(event.seat_count);
  });

  it("prices each section as the fixtures declare", async () => {
    for (const [section, price] of Object.entries(SECTION_PRICES)) {
      const body = await seatPage(token, ARENA, { section, page_size: 5 });
      expect(
        body.data.length,
        `section=${section} returned no seats, so its pricing could not be checked`
      ).toBeGreaterThan(0);
      for (const seat of body.data) {
        expect(
          seat.price_cents,
          `seat ${seat.id} in section ${section} is priced ${seat.price_cents}c, expected ${price}c`
        ).toBe(price);
        expect(
          Number.isInteger(seat.price_cents),
          `seat ${seat.id} price must be integer cents, got ${seat.price_cents}`
        ).toBe(true);
      }
    }
  });

  it("returns only seats in the requested availability state", async () => {
    for (const availability of ["available", "held", "sold"] as const) {
      const body = await seatPage(token, ARENA, { availability, page_size: 50 });
      const strays = [...new Set(body.data.map((s) => s.status))].filter((s) => s !== availability);
      expect(
        strays,
        `availability=${availability} also returned seats with status ${strays}`
      ).toEqual([]);
    }
  });

  it("combines the section and availability filters", async () => {
    const body = await seatPage(token, ARENA, { section: "B", availability: "available" });
    const whole = await seatPage(token, ARENA, { section: "B" });
    expect(
      body.total,
      `section B has ${whole.total} seats but the available subset reports ${body.total} — ` +
        `a subset cannot be larger than the whole`
    ).toBeLessThanOrEqual(whole.total);
    for (const seat of body.data) {
      expect(
        [seat.section, seat.status],
        `seat ${seat.id} came back from section=B&availability=available`
      ).toEqual(["B", "available"]);
    }
  });

  it("walks the seat map without skipping or repeating a seat", async () => {
    const pageSize = 200;
    const first = await seatPage(token, ARENA, { page: 1, page_size: pageSize });
    const pages = Math.ceil(first.total / pageSize);
    const seen = new Set<string>();
    for (let page = 1; page <= pages; page++) {
      const body = await seatPage(token, ARENA, { page, page_size: pageSize });
      for (const seat of body.data) seen.add(seat.id);
    }
    expect(
      seen.size,
      `walking ${pages} pages of ${pageSize} collected ${seen.size} distinct seats, ` +
        `but the event reports ${first.total}`
    ).toBe(first.total);
  });
});

describe("seat map validation", () => {
  it("rejects a section outside the contract's enum", async () => {
    const res = await api(`/events/${ARENA}/seats?section=Z`, { token });
    expectError(res, 400, "VALIDATION_ERROR", "a seat map filtered by section Z");
  });

  it("rejects an availability value outside the contract's enum", async () => {
    const res = await api(`/events/${ARENA}/seats?availability=maybe`, { token });
    expectError(res, 400, "VALIDATION_ERROR", "a seat map filtered by availability=maybe");
  });

  it("reports the seat map of an unknown event as not found", async () => {
    const res = await api("/events/event_does_not_exist/seats", { token });
    expectError(res, 404, "EVENT_NOT_FOUND", "the seat map of an unknown event");
  });

  it("describes each seat with every field the contract requires", async () => {
    const res = await api<Page<Seat>>(`/events/${ARENA}/seats?page=1&page_size=1`, { token });
    expect(res.status, "the seat map should be readable").toBe(200);
    const seat = res.body.data[0];
    expect(seat, "the arena seat map must not be empty").toBeTruthy();
    for (const field of ["id", "event_id", "section", "row", "number", "status", "price_cents"]) {
      expect(
        seat[field as keyof Seat],
        `seat ${seat.id} is missing the required field ${field}`
      ).not.toBeUndefined();
    }
    expect(seat.event_id, "a seat must report the event it belongs to").toBe(ARENA);
  });
});
