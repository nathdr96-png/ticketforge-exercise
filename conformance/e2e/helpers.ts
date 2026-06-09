import { expect, type Locator, type Page } from "@playwright/test";

import manifest from "../reserved-seats.json";

/**
 * Shared driving helpers for the web conformance suite.
 *
 * Everything here selects ONLY by the `data-testid` attributes in
 * contract/testids.md, so the same suite drives any web slot.
 *
 * Seats are addressed by their seeded id rather than "the first available seat".
 * That is deliberate: tests share one live backend, so two tests that both grab
 * "the first available seat" would fight over the same row and the suite would
 * be order-dependent. Giving every test its own named seat makes the suite
 * deterministic and safe to reorder.
 *
 * SEAT OWNERSHIP. On an integrated run this suite shares its database with
 * contract/analytics/fixture.sql, which SELLS named seats. The boundary is
 * declared in ../reserved-seats.json: rows 01 and 02 of every section belong to
 * the interactive suites; row 03 and up belong to the fixture.
 * contract/analytics/make-fixture.py greps the seat ids out of these spec files
 * and refuses to generate a fixture that crosses the line — so a new test must
 * name a seat in row 01 or 02. The other half of that boundary, where a seat may
 * be left `held`, is read from the same file HERE: see the seat-ownership section
 * below and `expectedHeldSeatCount()`. A test that counts held seats must derive
 * the number through it rather than writing a section letter and a count down.
 */

export const PASSWORD = "password123";

/** contract/seed/seed.json event ids. */
export const ARENA = "event_arena_2000";
export const CLUB = "event_club_100";
export const JAZZ = "event_jazz_eur";

/**
 * Seat prices come from contract/seed/seed.json
 * (`base_price_cents + section_price_delta_cents`):
 *   arena A 7000, B 6000, C 5000, D 4500   (USD)
 *   club  A 2500                           (USD)
 *   jazz  A 4000, B 3500                   (EUR)
 */
export const SEAT_PRICE = {
  arenaA: 7000,
  arenaB: 6000,
  arenaC: 5000,
  arenaD: 4500,
  clubA: 2500,
  jazzA: 4000,
  jazzB: 3500,
} as const;

/* ------------------------------------------------------------- seat ownership
 *
 * ../reserved-seats.json is the one declaration of which seats belong to which
 * family, and it has two halves.
 *
 * The ROW half — rows 01 and 02 are the interactive suites', 03 and up belong to
 * contract/analytics/fixture.sql — is enforced mechanically from the other side:
 * contract/analytics/make-fixture.py greps the seat ids out of these spec files
 * and refuses to write a fixture that crosses the line, in either direction.
 *
 * The SECTION half cannot be enforced that way. `analytics_hold_sections` names
 * one section per event where the fixture is allowed to leave a seat in `held`
 * status, and a test that COUNTS held seats is making a claim about an entire
 * section, which no row boundary can satisfy. The fixture side cannot see that
 * claim — a hard-coded section letter and a hard-coded count look like ordinary
 * test literals. So this suite reads the declaration instead: every held-seat
 * count goes through `expectedHeldSeatCount()`, which derives the number from
 * the manifest plus the test's own holds, and fails loudly with the reason
 * rather than asserting a number that only happens to be right today.
 *
 * Both halves are therefore now checked by machine, from the side that knows.
 */

interface SeatOwnership {
  /** Seat rows the interactive suites own, as two-digit labels. */
  interactive_rows: string[];
  /** event id -> the one section where the analytics fixture may park a hold. */
  analytics_hold_sections: Record<string, string>;
  owners: string[];
  seat_id_pattern: string;
}

export const SEAT_OWNERSHIP = manifest as unknown as SeatOwnership;

/** The seat code inside a seeded id: `seat_arena_D01-02` -> `"D01-02"`. */
function seatCode(seatId: string): string {
  const code = seatId.slice(seatId.lastIndexOf("_") + 1);
  expect(
    code,
    `${seatId} is not a seeded TicketForge seat id — if the id scheme changed, update ` +
      `seat_id_pattern in ../reserved-seats.json and these helpers together`,
  ).toMatch(/^[A-D]\d{2}-\d{2}$/);
  return code;
}

/** `seat_arena_D01-02` -> `"D"`. */
export function sectionOf(seatId: string): string {
  return seatCode(seatId).slice(0, 1);
}

/** `seat_arena_D01-02` -> `"01"` — the ROW, not the seat number. */
export function rowOf(seatId: string): string {
  return seatCode(seatId).slice(1, 3);
}

/**
 * How many seats a test may expect to find `held` in one section of one event.
 *
 * Read off ../reserved-seats.json rather than written down, because the honest
 * answer is "the ones this test is holding, plus whatever the analytics fixture
 * left there" — and the manifest is the only thing that knows where the fixture
 * leaves anything. Outside the event's declared `analytics_hold_sections`
 * section the fixture leaves nothing held, so the count is exactly the test's
 * own holds; inside it the number is not this suite's to predict, so asking for
 * it fails with an explanation instead of a wrong number.
 *
 * `heldByThisTest` is the seats the test itself is holding at the moment of the
 * count, named as seeded ids.
 */
export function expectedHeldSeatCount(
  eventId: string,
  section: string,
  heldByThisTest: readonly string[],
): number {
  const fixtureSection = SEAT_OWNERSHIP.analytics_hold_sections[eventId];
  expect(
    fixtureSection,
    `../reserved-seats.json declares no analytics_hold_sections entry for ${eventId}, so ` +
      `nothing stops contract/analytics/fixture.sql leaving an active hold in section ` +
      `${section}. Declare that event's hold section before counting held seats in it.`,
  ).toBeTruthy();
  expect(
    section,
    `this test counts held seats in ${eventId} section ${section}, but ` +
      `../reserved-seats.json parks the analytics fixture's active holds in exactly that ` +
      `section — the count would include seats this suite never created. Count in another ` +
      `section, or move analytics_hold_sections.${eventId} and regenerate ` +
      `contract/analytics/fixture.sql.`,
  ).not.toBe(fixtureSection);

  const own = heldByThisTest.filter((seatId) => sectionOf(seatId) === section);
  for (const seatId of own) {
    expect(
      SEAT_OWNERSHIP.interactive_rows,
      `${seatId} sits in row ${rowOf(seatId)}, outside the rows the interactive suites own, ` +
        `so the analytics fixture may own that seat too and the count is not predictable.`,
    ).toContain(rowOf(seatId));
  }
  return own.length;
}

/** contract/scenarios/T3-orders-money.md — the only money rules that exist. */
export function discountCents(subtotal: number, percentOff: number): number {
  return Math.floor((subtotal * percentOff) / 100);
}
export function feeCents(subtotalAfterDiscount: number): number {
  return Math.floor((subtotalAfterDiscount * 5) / 100) + 30;
}
export function expectedBreakdown(subtotal: number, percentOff = 0) {
  const discount = discountCents(subtotal, percentOff);
  const after = subtotal - discount;
  const fee = feeCents(after);
  return { subtotal, discount, fee, total: after + fee };
}

export async function login(page: Page, email: string): Promise<void> {
  await page.goto("/");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("event-list")).toBeVisible();
  // The list container is allowed to render while the request is still in flight,
  // so "visible" is not "loaded". Wait for real rows: without this, a test that
  // reads the event total straight after logging in sometimes reads the
  // pre-response zero, and fails for no reason on a loaded machine.
  await expect(page.getByTestId("event-card").first()).toBeAttached();
}

/** Open an event from the list and wait for the whole seat map to be present. */
export async function openEvent(page: Page, eventId: string): Promise<void> {
  await page.locator(`[data-testid="event-card"][data-event-id="${eventId}"]`).click();
  await expect(page.getByTestId("seat-map")).toBeVisible();
  await expect(page.locator('[data-testid="seat"]').first()).toBeAttached();
}

export function seat(page: Page, seatId: string): Locator {
  return page.locator(`[data-testid="seat"][data-seat-id="${seatId}"]`);
}

export function seats(page: Page): Locator {
  return page.locator('[data-testid="seat"]');
}

/** Integer cents carried by a `data-cents` element, per contract/testids.md. */
export async function cents(locator: Locator): Promise<number> {
  const raw = await locator.getAttribute("data-cents");
  expect(raw, "every money element must carry integer data-cents").toMatch(/^-?\d+$/);
  return Number(raw);
}

/** Select one named seat and place a hold on it. */
export async function holdSeat(page: Page, seatId: string): Promise<void> {
  const target = seat(page, seatId);
  await expect(target).toHaveAttribute("data-status", "available");
  await target.click();
  await page.getByTestId("hold-button").click();
  await expect(page.getByTestId("hold-countdown")).toBeVisible();
}

/** Whole seconds left on the hold, from the contract's `data-seconds-remaining`. */
export async function secondsRemaining(page: Page): Promise<number> {
  const raw = await page.getByTestId("hold-countdown").getAttribute("data-seconds-remaining");
  expect(raw, "hold-countdown must carry data-seconds-remaining").toMatch(/^\d+$/);
  return Number(raw);
}
