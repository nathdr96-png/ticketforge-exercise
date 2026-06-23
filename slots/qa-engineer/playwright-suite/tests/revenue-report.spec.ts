import { describe, expect, it } from "vitest";
import {
  ARENA,
  CLUB,
  JAZZ,
  ORGANIZER_EVENTS,
  api,
  buySeats,
  expectError,
  expectIntegerCents,
  revenueReport,
  tokenFor,
  type RevenueReport,
} from "./helpers.js";

const ORG1 = "org1@ticketforge.test";
const ORG2 = "org2@ticketforge.test";
const ADMIN = "admin@ticketforge.test";

const HEADLINE = ["gross_cents", "fees_cents", "discounts_cents", "net_cents"];

/** The revenue report is what an organizer gets paid on. */
describe("revenue report arithmetic", () => {
  it("reports every headline figure", async () => {
    const buyer = await tokenFor("buyer12@ticketforge.test");
    await buySeats(buyer, CLUB, { discountCode: "SAVE10" });

    const org = await tokenFor(ORG1);
    const report = await revenueReport(org);
    expectIntegerCents(report as unknown as Record<string, unknown>, HEADLINE, "revenue report");

    expect(
      report.discounts_cents,
      "a discounted order was just paid for, so the report cannot show zero discounts"
    ).toBeGreaterThan(0);
    expect(report.fees_cents, "paid orders carry booking fees").toBeGreaterThan(0);
    expect(report.gross_cents, "paid orders carry seat revenue").toBeGreaterThan(0);
    expect(report.net_cents, "paid orders collect money").toBeGreaterThan(0);
  });

  it("sums by_event to the headline figures", async () => {
    const report = await revenueReport(await tokenFor(ORG1));
    expect(report.by_event.length, "the report must break revenue down by event").toBeGreaterThan(0);

    const sumGross = report.by_event.reduce((s, e) => s + e.gross_cents, 0);
    const sumNet = report.by_event.reduce((s, e) => s + e.net_cents, 0);
    expect(
      sumGross,
      `by_event gross sums to ${sumGross} but the headline gross is ${report.gross_cents}`
    ).toBe(report.gross_cents);
    expect(
      sumNet,
      `by_event net sums to ${sumNet} but the headline net is ${report.net_cents}`
    ).toBe(report.net_cents);
    for (const row of report.by_event) {
      expect(
        row.order_count,
        `by_event row for ${row.event_id} reports ${row.order_count} orders`
      ).toBeGreaterThan(0);
      expectIntegerCents(
        row as unknown as Record<string, unknown>,
        ["gross_cents", "net_cents"],
        `by_event row ${row.event_id}`
      );
    }
  });
});

describe("revenue report scope", () => {
  it("shows each organizer only their own events", async () => {
    // Give both organizers revenue, so neither assertion can pass just because a
    // report is empty.
    await buySeats(await tokenFor("buyer12@ticketforge.test"), CLUB, {});
    await buySeats(await tokenFor("buyer13@ticketforge.test"), JAZZ, {});

    const checks: [string, RevenueReport][] = [
      [ORG1, await revenueReport(await tokenFor(ORG1))],
      [ORG2, await revenueReport(await tokenFor(ORG2))],
    ];
    for (const [who, report] of checks) {
      const mine = ORGANIZER_EVENTS[who];
      const strays = report.by_event.map((e) => e.event_id).filter((id) => !mine.includes(id));
      expect(
        strays,
        `${who}'s revenue report includes event(s) ${strays} that belong to another organizer`
      ).toEqual([]);
      expect(
        report.by_event.length,
        `${who} has at least one paid order, so their report must not be empty`
      ).toBeGreaterThan(0);
    }

    const org1Events = checks[0][1].by_event.map((e) => e.event_id);
    expect(org1Events, `${ORG1} does not own ${JAZZ}`).not.toContain(JAZZ);
    const org2Events = checks[1][1].by_event.map((e) => e.event_id);
    expect(org2Events, `${ORG2} does not own ${ARENA}`).not.toContain(ARENA);
    expect(org2Events, `${ORG2} does not own ${CLUB}`).not.toContain(CLUB);
  });

  it("reports each organizer's own currency", async () => {
    await buySeats(await tokenFor("buyer13@ticketforge.test"), JAZZ, {});
    const report = await revenueReport(await tokenFor(ORG2));
    expect(report.currency, `${JAZZ} is priced in EUR, so ${ORG2}'s report is in EUR`).toBe("EUR");
  });

  it("shows an admin every organizer's revenue", async () => {
    const org1 = await revenueReport(await tokenFor(ORG1));
    const org2 = await revenueReport(await tokenFor(ORG2));
    const admin = await revenueReport(await tokenFor(ADMIN));

    const adminEvents = admin.by_event.map((e) => e.event_id);
    for (const row of [...org1.by_event, ...org2.by_event]) {
      expect(
        adminEvents,
        `an admin's report is missing ${row.event_id}, which appears in an organizer's report`
      ).toContain(row.event_id);
    }
    expect(
      admin.gross_cents,
      `admin gross ${admin.gross_cents} is below the ${org1.gross_cents + org2.gross_cents} ` +
        `the two organizers can already see between them`
    ).toBeGreaterThanOrEqual(org1.gross_cents + org2.gross_cents);
  });

  it("narrows the report to one event when asked", async () => {
    const org = await tokenFor(ORG1);
    const whole = await revenueReport(org);
    const filtered = await revenueReport(org, { event_id: CLUB });

    expect(
      filtered.by_event.map((e) => e.event_id),
      `event_id=${CLUB} must restrict by_event to that event alone`
    ).toEqual([CLUB]);
    const clubRow = whole.by_event.find((e) => e.event_id === CLUB);
    expect(clubRow, `${CLUB} must appear in the unfiltered report`).toBeTruthy();
    expect(
      filtered.gross_cents,
      `the filtered gross must match ${CLUB}'s row in the unfiltered report`
    ).toBe(clubRow!.gross_cents);
    expect(
      filtered.net_cents,
      `the filtered net must match ${CLUB}'s row in the unfiltered report`
    ).toBe(clubRow!.net_cents);
  });

  it("excludes a window with no orders in it", async () => {
    const org = await tokenFor(ORG1);
    const report = await revenueReport(org, {
      from: "2000-01-01T00:00:00.000Z",
      to: "2000-12-31T23:59:59.000Z",
    });
    expect(report.by_event, "no orders were paid in the year 2000").toEqual([]);
    for (const field of HEADLINE) {
      expect(
        report[field as keyof RevenueReport],
        `${field} must be 0 for a window with no orders, got ${report[field as keyof RevenueReport]}`
      ).toBe(0);
    }
  });

  it("keeps the report away from callers without an organizer role", async () => {
    const buyer = await tokenFor("buyer12@ticketforge.test");
    expectError(
      await api("/reports/revenue", { token: buyer }),
      403,
      "INSUFFICIENT_PERMISSION",
      "a buyer reading the revenue report"
    );
  });
});
