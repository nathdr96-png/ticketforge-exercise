import { expect, test } from "@playwright/test";
import {
  ARENA,
  CLUB,
  JAZZ,
  SEAT_PRICE,
  cents,
  expectedBreakdown,
  expectedHeldSeatCount,
  holdSeat,
  login,
  openEvent,
  seat,
  seats,
  secondsRemaining,
  sectionOf,
} from "./helpers";

/**
 * Drives ANY web UI slot via contract/testids.md data-testid attributes.
 * Set WEB_BASE_URL to the web app (not the API). API is assumed mocked or live.
 *
 * Every test logs in as its own buyer and works on its own named seats
 * (see helpers.ts) so the suite is deterministic and order-independent.
 */
test.describe("TicketForge web e2e", () => {
  test("login and see events", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("login-email").fill("buyer01@ticketforge.test");
    await page.getByTestId("login-password").fill("password123");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("event-list")).toBeVisible();
    await expect(page.getByTestId("event-card").first()).toBeVisible();
  });

  test("hold and checkout happy path", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("login-email").fill("buyer02@ticketforge.test");
    await page.getByTestId("login-password").fill("password123");
    await page.getByTestId("login-submit").click();
    await page.getByTestId("event-card").first().click();
    await expect(page.getByTestId("seat-map")).toBeVisible();
    await page.locator('[data-testid="seat"][data-status="available"]').first().click();
    await page.getByTestId("hold-button").click();
    await expect(page.getByTestId("hold-countdown")).toBeVisible();
    await page.getByTestId("checkout-button").click();
    await expect(page.getByTestId("order-confirmation")).toBeVisible();
    const cents = await page.getByTestId("order-total").getAttribute("data-cents");
    expect(cents).toMatch(/^\d+$/);
  });

  /**
   * A rejected login must surface the contract's error code, not a blank form or
   * a raw stack trace. Catches a UI that swallows the error envelope from
   * contract/errors.md, or renders it as "[object Object]" with no code.
   */
  test("login failure surfaces UNAUTHENTICATED and stays on the login form", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("login-email").fill("buyer03@ticketforge.test");
    await page.getByTestId("login-password").fill("not-the-password");
    await page.getByTestId("login-submit").click();

    const banner = page.getByTestId("error-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-error-code", "UNAUTHENTICATED");
    await expect(banner).not.toContainText("[object Object]");
    await expect(banner).not.toHaveText("");

    // Still unauthenticated: the login form is there and no event list appeared.
    await expect(page.getByTestId("login-submit")).toBeVisible();
    await expect(page.getByTestId("event-list")).toHaveCount(0);
  });

  /**
   * Pagination integrity: walking every page must yield each event exactly once,
   * and page 1 must start at the beginning of the collection. Catches a 1-based
   * page sent as a 0-based offset (first row missing, last page empty) and a
   * page-size control that is displayed but not sent to the API.
   */
  test("events list paginates without losing or repeating an event", async ({ page }) => {
    await login(page, "buyer04@ticketforge.test");

    // Retrying assertion first: the count element may render a placeholder zero
    // while the first request is still in flight.
    await expect(page.getByTestId("event-total")).toHaveAttribute("data-total", /^[1-9][0-9]*$/);
    const total = Number(await page.getByTestId("event-total").getAttribute("data-total"));
    expect(total, "the seed must publish more than one event").toBeGreaterThan(1);

    // Everything on one page, as the reference set.
    await page.getByTestId("events-page-size").selectOption("25");
    await expect(page.getByTestId("events-page")).toHaveAttribute("data-page-count", "1");
    const allAtOnce = await page.locator("[data-testid=event-card]").evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-event-id")),
    );
    expect(allAtOnce).toHaveLength(total);

    // Two per page: same events, same order, split across pages.
    await page.getByTestId("events-page-size").selectOption("2");
    const indicator = page.getByTestId("events-page");
    await expect(indicator).toHaveAttribute("data-page-size", "2");
    await expect(indicator).toHaveAttribute("data-page-count", String(Math.ceil(total / 2)));
    await expect(indicator).toHaveAttribute("data-page", "1");
    await expect(page.getByTestId("events-prev")).toBeDisabled();

    const pageCount = Math.ceil(total / 2);
    const walked: (string | null)[] = [];
    for (let p = 1; p <= pageCount; p++) {
      await expect(indicator).toHaveAttribute("data-page", String(p));
      const expectedOnPage = Math.min(2, total - (p - 1) * 2);
      await expect(page.locator("[data-testid=event-card]")).toHaveCount(expectedOnPage);
      walked.push(
        ...(await page.locator("[data-testid=event-card]").evaluateAll((els) =>
          els.map((el) => el.getAttribute("data-event-id")),
        )),
      );
      if (p < pageCount) {
        await page.getByTestId("events-next").click();
      } else {
        await expect(page.getByTestId("events-next")).toBeDisabled();
      }
    }

    expect(new Set(walked).size, `duplicates across pages: ${walked.join(",")}`).toBe(total);
    expect(walked, "paged order must match the unpaged order").toEqual(allAtOnce);

    // Going back must not skip the first page's events either.
    await page.getByTestId("events-prev").click();
    await expect(indicator).toHaveAttribute("data-page", String(pageCount - 1));
  });

  /**
   * The 2,000-seat arena must render completely. Catches a UI that only ever
   * loads the first page of GET /events/{id}/seats (200 of 2,000) and therefore
   * silently hides 90% of the inventory.
   */
  test("the 2,000-seat map renders every seat", async ({ page }) => {
    await login(page, "buyer05@ticketforge.test");
    await openEvent(page, ARENA);

    await expect(seats(page)).toHaveCount(2000);
    await expect(page.getByTestId("seat-count-visible")).toHaveText("2000");

    // Every seat carries the identifying attributes the contract requires.
    const sample = seat(page, "seat_arena_A01-01");
    await expect(sample).toHaveAttribute("data-section", "A");
    await expect(sample).toHaveAttribute("data-status", /^(available|held|sold)$/);
  });

  /**
   * Filtering by section must narrow the map to that section only. Catches the
   * two filters being combined with OR instead of AND (any single empty filter
   * then makes the whole predicate true and nothing is ever filtered out) and a
   * case-folded comparison against the contract's upper-case section letters.
   */
  test("seat map filters by section", async ({ page }) => {
    await login(page, "buyer06@ticketforge.test");
    await openEvent(page, ARENA);

    await page.getByTestId("filter-section").selectOption("B");
    // 25 rows x 20 seats per section in contract/seed/seed.json.
    await expect(seats(page)).toHaveCount(500);
    await expect(page.getByTestId("seat-count-visible")).toHaveText("500");

    const sections = await seats(page).evaluateAll((els) =>
      Array.from(new Set(els.map((el) => el.getAttribute("data-section")))),
    );
    expect(sections, "only section B seats may be shown").toEqual(["B"]);

    // Clearing the filter restores the whole map.
    await page.getByTestId("filter-section").selectOption("");
    await expect(seats(page)).toHaveCount(2000);
  });

  /**
   * Filtering by availability must hide seats that are not in that state, and it
   * must compose with the section filter. The held seat is created inside the
   * test so the assertion does not depend on what other tests have sold.
   *
   * The section this counts held seats in, and the number it expects to find, are
   * both derived from ../reserved-seats.json by `expectedHeldSeatCount()` rather
   * than written down here. A count over a whole section is a claim about every
   * other writer to that section, and on an integrated run the other writer is
   * contract/analytics/fixture.sql — which declares, in that file, the one
   * section per event where it parks an active hold. Hard-coding "section D,
   * exactly one" made this test silently depend on that declaration without ever
   * reading it; deriving it means moving the declaration fails here, loudly, with
   * the reason, instead of producing a mystery count on the integrated run.
   */
  test("seat map filters by availability", async ({ page }) => {
    await login(page, "buyer30@ticketforge.test");
    await openEvent(page, ARENA);

    const mine = "seat_arena_D01-01";
    const countSection = sectionOf(mine);
    const expectedHeld = expectedHeldSeatCount(ARENA, countSection, [mine]);

    await holdSeat(page, mine);
    await expect(seat(page, mine)).toHaveAttribute("data-status", "held");

    await page.getByTestId("filter-availability").selectOption("available");
    await expect(seat(page, mine), "a held seat must not show under 'available'").toHaveCount(0);
    const statuses = await seats(page).evaluateAll((els) =>
      Array.from(new Set(els.map((el) => el.getAttribute("data-status")))),
    );
    expect(statuses).toEqual(["available"]);

    // Composed with the section filter: both predicates must hold at once.
    await page.getByTestId("filter-section").selectOption(countSection);
    const both = await seats(page).evaluateAll((els) =>
      els.map((el) => `${el.getAttribute("data-section")}/${el.getAttribute("data-status")}`),
    );
    expect(both.length).toBeGreaterThan(0);
    expect(Array.from(new Set(both))).toEqual([`${countSection}/available`]);

    await page.getByTestId("filter-availability").selectOption("held");
    await expect(seats(page)).toHaveCount(expectedHeld);
    await expect(seat(page, mine)).toBeAttached();

    await page.getByTestId("release-button").click();
    await expect(page.getByTestId("hold-button")).toBeVisible();
  });

  /**
   * Selecting a seat, holding it, and seeing a countdown that reflects the
   * contract's 600s TTL. Catches a countdown that renders a placeholder, counts
   * up, or is not derived from the server's `expires_at` at all.
   */
  test("selecting a seat places a hold and shows the countdown", async ({ page }) => {
    await login(page, "buyer31@ticketforge.test");
    await openEvent(page, CLUB);

    const mine = "seat_club_A01-01";
    await expect(seat(page, mine)).toHaveAttribute("data-status", "available");
    await seat(page, mine).click();

    await page.getByTestId("hold-button").click();
    const countdown = page.getByTestId("hold-countdown");
    await expect(countdown).toBeVisible();

    const left = await secondsRemaining(page);
    expect(left, "a fresh hold has at most the 600s contract TTL left").toBeLessThanOrEqual(600);
    expect(left, "a fresh hold has not already expired").toBeGreaterThan(500);
    await expect(countdown).toContainText(/\d?\d:\d\d/);

    // The seat is now held, and checkout is offered.
    await expect(seat(page, mine)).toHaveAttribute("data-status", "held");
    await expect(page.getByTestId("checkout-button")).toBeEnabled();
  });

  /**
   * The losing buyer in a race must see the contract's SEAT_ALREADY_HELD code.
   * Catches a UI that reports a generic 500/INTERNAL_ERROR, or swallows the 409
   * and pretends the hold succeeded.
   */
  test("a second buyer on the same seat sees SEAT_ALREADY_HELD", async ({ browser }) => {
    const contested = "seat_arena_B01-01";

    const winnerCtx = await browser.newContext();
    const loserCtx = await browser.newContext();
    try {
      const winner = await winnerCtx.newPage();
      const loser = await loserCtx.newPage();

      await login(winner, "buyer32@ticketforge.test");
      await openEvent(winner, ARENA);

      // The loser must load the map while the seat is still free, so that their
      // click is on a seat they believe is available — the real race.
      await login(loser, "buyer33@ticketforge.test");
      await openEvent(loser, ARENA);
      await expect(seat(loser, contested)).toHaveAttribute("data-status", "available");
      await seat(loser, contested).click();

      await holdSeat(winner, contested);

      await loser.getByTestId("hold-button").click();
      const banner = loser.getByTestId("error-banner");
      await expect(banner).toBeVisible();
      await expect(banner).toHaveAttribute("data-error-code", "SEAT_ALREADY_HELD");
      await expect(loser.getByTestId("hold-countdown")).toHaveCount(0);
    } finally {
      await winnerCtx.close();
      await loserCtx.close();
    }
  });

  /**
   * Releasing a hold must put the seat back on the market. Catches a UI that
   * clears its own state but never calls DELETE /holds/{id}, leaving the seat
   * stuck as held for every other buyer.
   */
  test("releasing a hold returns the seat to available", async ({ page, browser }) => {
    const mine = "seat_arena_C01-01";
    await login(page, "buyer34@ticketforge.test");
    await openEvent(page, ARENA);
    await holdSeat(page, mine);
    await expect(seat(page, mine)).toHaveAttribute("data-status", "held");

    await page.getByTestId("release-button").click();
    await expect(page.getByTestId("hold-countdown")).toHaveCount(0);
    await expect(page.getByTestId("hold-button")).toBeVisible();
    await expect(seat(page, mine)).toHaveAttribute("data-status", "available");

    // And it is genuinely free server-side, not just in this browser's state.
    const other = await browser.newContext();
    try {
      const page2 = await other.newPage();
      await login(page2, "buyer35@ticketforge.test");
      await openEvent(page2, ARENA);
      await expect(seat(page2, mine)).toHaveAttribute("data-status", "available");
    } finally {
      await other.close();
    }
  });

  /**
   * The confirmed order must show subtotal / discount / fee / total as the exact
   * integer cents the contract formula produces. Catches float money (a total a
   * cent out), a fee computed with the wrong rule, and a total that is merely
   * the subtotal.
   */
  test("checkout shows an exact integer-cent money breakdown", async ({ page }) => {
    const mine = "seat_jazz_A01-01";
    const want = expectedBreakdown(SEAT_PRICE.jazzA); // 4000 -> fee 230, total 4230

    await login(page, "buyer36@ticketforge.test");
    await openEvent(page, JAZZ);
    await holdSeat(page, mine);

    // The pre-order preview must already agree with the contract formula.
    expect(await cents(page.getByTestId("checkout-subtotal"))).toBe(want.subtotal);
    expect(await cents(page.getByTestId("checkout-discount"))).toBe(0);
    expect(await cents(page.getByTestId("checkout-fee"))).toBe(want.fee);
    expect(await cents(page.getByTestId("checkout-total"))).toBe(want.total);

    await page.getByTestId("checkout-button").click();
    await expect(page.getByTestId("order-confirmation")).toBeVisible();

    expect(await cents(page.getByTestId("order-subtotal"))).toBe(want.subtotal);
    expect(await cents(page.getByTestId("order-discount"))).toBe(0);
    expect(await cents(page.getByTestId("order-fee"))).toBe(want.fee);
    expect(await cents(page.getByTestId("order-total"))).toBe(want.total);

    // Displayed text and machine value must agree: 4230 cents is 42.30.
    await expect(page.getByTestId("order-total")).toContainText("42.30");
    await expect(page.getByTestId("order-confirmation")).toHaveAttribute("data-order-id", /.+/);
  });

  /**
   * A valid code must recompute the total; an invalid one must surface
   * DISCOUNT_INVALID and leave the hold intact so the buyer can retry.
   *
   * The code is typed in lower case on purpose: promo codes are printed on
   * mailers and typed by hand, and the contract's codes are upper case. A UI that
   * forwards the raw input gets DISCOUNT_INVALID for a perfectly good code.
   */
  test("discount codes recompute the total; a bad code does not destroy the hold", async ({ page }) => {
    const mine = "seat_jazz_B01-01";
    const plain = expectedBreakdown(SEAT_PRICE.jazzB); // 3500 -> fee 205, total 3705
    const saved = expectedBreakdown(SEAT_PRICE.jazzB, 10); // 350 off -> fee 187, total 3337

    await login(page, "buyer37@ticketforge.test");
    await openEvent(page, JAZZ);
    await holdSeat(page, mine);
    expect(await cents(page.getByTestId("checkout-total"))).toBe(plain.total);

    await page.getByTestId("discount-code").fill("save10");
    await page.getByTestId("discount-apply").click();
    expect(
      await cents(page.getByTestId("checkout-discount")),
      "applying a known code must preview the discount",
    ).toBe(saved.discount);
    expect(await cents(page.getByTestId("checkout-fee"))).toBe(saved.fee);
    expect(await cents(page.getByTestId("checkout-total"))).toBe(saved.total);

    // An unknown code is the server's call, and it must not cost the buyer the hold.
    await page.getByTestId("discount-code").fill("NOT-A-CODE");
    await page.getByTestId("discount-apply").click();
    await page.getByTestId("checkout-button").click();
    const banner = page.getByTestId("error-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-error-code", "DISCOUNT_INVALID");
    await expect(page.getByTestId("hold-countdown"), "the hold must survive a rejected code").toBeVisible();
    await expect(page.getByTestId("order-confirmation")).toHaveCount(0);

    // Back to the good code: the order is created at the discounted amount.
    await page.getByTestId("discount-code").fill("save10");
    await page.getByTestId("discount-apply").click();
    await page.getByTestId("checkout-button").click();
    await expect(page.getByTestId("order-confirmation")).toBeVisible();
    expect(await cents(page.getByTestId("order-discount"))).toBe(saved.discount);
    expect(await cents(page.getByTestId("order-fee"))).toBe(saved.fee);
    expect(await cents(page.getByTestId("order-total"))).toBe(saved.total);
  });

  /**
   * POST /orders must carry an Idempotency-Key (contract/errors.md:
   * IDEMPOTENCY_KEY_REQUIRED). Catches a UI that relies on the server not
   * enforcing it, or puts the key in the body instead of the header.
   */
  test("checkout sends an Idempotency-Key header", async ({ page }) => {
    const mine = "seat_club_A01-02";
    const sent: (string | null)[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && new URL(req.url()).pathname.endsWith("/orders")) {
        sent.push(req.headers()["idempotency-key"] ?? null);
      }
    });

    await login(page, "buyer38@ticketforge.test");
    await openEvent(page, CLUB);
    await holdSeat(page, mine);

    const shown = await page.getByTestId("idempotency-key").inputValue();
    await page.getByTestId("checkout-button").click();
    await expect(page.getByTestId("order-confirmation")).toBeVisible();

    expect(sent, "exactly one POST /orders for one checkout").toHaveLength(1);
    const key = sent[0];
    expect(key, "Idempotency-Key header is required on POST /orders").not.toBeNull();
    expect(key!.length, "the contract allows 8..128 characters").toBeGreaterThanOrEqual(8);
    expect(key!.length).toBeLessThanOrEqual(128);
    expect(key, "the key the UI exposes must be the key it sends").toBe(shown);
  });

  /**
   * Revenue reporting is organizer/admin only. Catches a UI that renders the
   * numbers for anyone who can reach the route, and one that hides the link but
   * leaks the data when the URL is typed directly.
   */
  test("an organizer sees the revenue report and a buyer cannot", async ({ browser }) => {
    const orgCtx = await browser.newContext();
    const buyerCtx = await browser.newContext();
    try {
      const org = await orgCtx.newPage();
      await login(org, "org1@ticketforge.test");
      await expect(org.getByTestId("nav-reports")).toBeVisible();
      await org.getByTestId("nav-reports").click();
      await expect(org.getByTestId("revenue-report")).toBeVisible();

      const buyer = await buyerCtx.newPage();
      await login(buyer, "buyer39@ticketforge.test");
      await expect(buyer.getByTestId("nav-reports"), "buyers get no revenue link").toHaveCount(0);

      // Reaching the route directly must not produce numbers.
      await buyer.goto("/#/reports");
      const banner = buyer.getByTestId("error-banner");
      await expect(banner).toBeVisible();
      await expect(banner).toHaveAttribute("data-error-code", "INSUFFICIENT_PERMISSION");
      await expect(buyer.getByTestId("revenue-report")).toHaveCount(0);
    } finally {
      await orgCtx.close();
      await buyerCtx.close();
    }
  });
});
