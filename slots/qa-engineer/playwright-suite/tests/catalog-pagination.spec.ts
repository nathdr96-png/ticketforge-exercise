import { beforeAll, describe, expect, it } from "vitest";
import {
  ARENA,
  api,
  expectError,
  expectIntegerCents,
  expectUtcIso,
  getEvent,
  type Event,
  type Page,
  tokenFor,
} from "./helpers.js";

let token: string;

beforeAll(async () => {
  token = await tokenFor("buyer02@ticketforge.test");
});

async function eventPage(page: number, pageSize: number): Promise<Page<Event>> {
  const res = await api<Page<Event>>(`/events?page=${page}&page_size=${pageSize}`, { token });
  expect(
    res.status,
    `GET /events?page=${page}&page_size=${pageSize} should be 200, got ${res.status}`
  ).toBe(200);
  return res.body;
}

describe("events list pagination", () => {
  it("returns a page of events", async () => {
    const body = await eventPage(1, 50);
    expect(Array.isArray(body.data), "the events list must return an array").toBe(true);
    expect(body.page, "the response must echo the requested page").toBe(1);
    expect(body.page_size, "the response must echo the requested page_size").toBe(50);
    expect(body.total, "the fixtures seed published events").toBeGreaterThan(0);
  });

  it("returns an empty page past the end without losing the total", async () => {
    const whole = await eventPage(1, 200);
    const past = await eventPage(whole.total + 5, 1);
    expect(past.data, `page ${whole.total + 5} is past the end and must be empty`).toEqual([]);
    expect(past.total, "the total must still describe the whole collection").toBe(whole.total);
  });
});

describe("event representation", () => {
  it("describes an event with every field the contract requires", async () => {
    const event = await getEvent(token, ARENA);
    for (const field of [
      "id",
      "organizer_id",
      "title",
      "venue",
      "starts_at",
      "currency",
      "base_price_cents",
      "status",
      "seat_count",
    ]) {
      expect(
        event[field as keyof Event],
        `GET /events/${ARENA} is missing the required field ${field}`
      ).not.toBeUndefined();
    }
    expectIntegerCents(event as unknown as Record<string, unknown>, ["base_price_cents"], ARENA);
    expectUtcIso(event.starts_at, `${ARENA} starts_at`);
    expect(event.currency, `${ARENA} is seeded in USD`).toBe("USD");
    expect(event.status, `${ARENA} is seeded as published`).toBe("published");
    expect(event.seat_count, `${ARENA} is seeded with exactly 2000 seats`).toBe(2000);
  });

  it("treats the unfiltered list as the published catalogue", async () => {
    // The fixtures seed five events, three of them published; the other two are
    // the draft and cancelled edge cases, which buyers must not see here.
    const unfiltered = await eventPage(1, 1);
    expect(
      unfiltered.total,
      `the unfiltered catalogue reported ${unfiltered.total} events — ` +
        `the fixtures publish exactly 3 of their 5 events`
    ).toBe(3);
    expect(unfiltered.data.length, "page 1 of the catalogue must carry an event").toBe(1);
    expect(
      unfiltered.data[0].status,
      `the catalogue returned ${unfiltered.data[0].id} with status ` +
        `${unfiltered.data[0].status} — only published events belong in it`
    ).toBe("published");
  });

  it("filters the list by status when asked", async () => {
    const res = await api<Page<Event>>("/events?status=draft&page=1&page_size=1", { token });
    expect(res.status, "GET /events?status=draft should be 200").toBe(200);
    expect(
      res.body.total,
      `status=draft reported ${res.body.total} events — the fixtures seed exactly one draft event`
    ).toBe(1);
  });

  it("reports an unknown event as not found", async () => {
    const res = await api("/events/event_does_not_exist", { token });
    expectError(res, 404, "EVENT_NOT_FOUND", "GET an unknown event");
  });
});
