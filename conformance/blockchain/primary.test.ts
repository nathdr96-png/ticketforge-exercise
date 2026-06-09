import { beforeEach, describe, expect, it } from "vitest";
import { discountCodeOf, loadRules, ruleText } from "./contract.js";
import {
  account,
  asAccount,
  chainProvider,
  freshSale,
  revertName,
  setBlockTime,
  setNextBlockTime,
  type Sale,
} from "./chain.js";
import {
  ZERO_CODE,
  buyPrimary,
  buyWithValue,
  expectedCost,
  fixtureFor,
  registerGraderEvent,
  type EventFixture,
} from "./helpers.js";

/**
 * ONC-010..ONC-023 and ONC-040..ONC-041 — the primary sale, one rule at a time.
 *
 * Every figure asserted here is derived from `contract/seed/` and the product's
 * published money rule, never read back from the contract and compared against
 * itself.
 */

const RULES = loadRules();
const BUYERS = RULES.accounts.buyers;

describe("onchain primary sale", () => {
  let sale: Sale;
  let club: EventFixture;
  let jazz: EventFixture;

  beforeEach(async () => {
    sale = await freshSale();
    club = fixtureFor("event_club_100");
    jazz = fixtureFor("event_jazz_eur");
  });

  it(`ONC-010 ${ruleText("ONC-010")}`, async () => {
    const buyer = account(BUYERS[0]);
    const seat = club.seats[0];
    await buyPrimary(sale, buyer, club, [seat]);

    expect(await sale.token.ownerOf(seat.tokenId)).toBe(buyer.address);
    expect(await sale.token.eventOf(seat.tokenId)).toBe(club.eventId);
    // ERC-721, not something that merely looks like one.
    expect(await sale.token.supportsInterface("0x80ac58cd")).toBe(true);
    expect(await sale.token.balanceOf(buyer.address)).toBe(1n);

    // Only the sale may mint. A ticket an organiser can mint for themselves is
    // inventory that never went through the window, the cap or the fee.
    const { token } = asAccount(sale, account(BUYERS[1]));
    expect(await revertName(token.mint(buyer.address, club.seats[1].tokenId, club.eventId))).toBe(
      "OnlySale"
    );
  });

  it(`ONC-011 ${ruleText("ONC-011")}`, async () => {
    const seat = club.seats[2];
    await buyPrimary(sale, account(BUYERS[0]), club, [seat]);

    // A second buyer, a second transaction, the same seat.
    const second = account(BUYERS[1]);
    const { total } = expectedCost(sale, [seat]);
    await expect(buyWithValue(sale, second, club, [seat], total)).rejects.toThrow();
    expect(await sale.token.ownerOf(seat.tokenId)).toBe(account(BUYERS[0]).address);

    // And the same seat twice inside ONE basket, which is the ordering a buyer
    // can arrange without racing anybody.
    const both = [club.seats[3], club.seats[3]];
    const cost = expectedCost(sale, both);
    await expect(buyWithValue(sale, second, club, both, cost.total)).rejects.toThrow();
    expect(await sale.token.exists(club.seats[3].tokenId)).toBe(false);
  });

  it(`ONC-012 ${ruleText("ONC-012")}`, async () => {
    // A seat of the jazz event cannot be bought through the club event, which
    // is also the cheap way to buy a 4000-unit seat for 2500.
    const { total } = expectedCost(sale, [jazz.seats[0]]);
    expect(await revertName(buyWithValue(sale, account(BUYERS[0]), club, [jazz.seats[0]], total))).toBe(
      "SeatNotForThisEvent"
    );

    // A seat that is not in the seed at all is not for sale either.
    const invented = { ...club.seats[0], tokenId: club.seats[0].tokenId + 1n, seatId: "invented" };
    await expect(
      buyWithValue(sale, account(BUYERS[0]), club, [invented], expectedCost(sale, [invented]).total)
    ).rejects.toThrow();

    const ev = await sale.sale.eventOf(club.eventId);
    expect(ev.mintedCount).toBe(0n);
    expect(ev.seatCount).toBe(BigInt(club.seats.length));
  });

  it(`ONC-020 ${ruleText("ONC-020")}`, async () => {
    const buyer = account(BUYERS[0]);
    // Two seats in different jazz sections: 4000 + 3500 = 7500.
    const basket = [
      jazz.seats.find((s) => s.section === "A")!,
      jazz.seats.find((s) => s.section === "B")!,
    ];
    const want = expectedCost(sale, basket);
    expect(want.subtotal).toBe(7500n);
    expect(want.fee).toBe(7500n / 20n + 30n); // floor(7500 * 5 / 100) + 30 = 405
    expect(want.total).toBe(7905n);

    const quoted = await sale.sale.quote(jazz.eventId, basket.map((s) => s.tokenId), ZERO_CODE);
    expect(quoted.subtotalUnits).toBe(want.subtotal);
    expect(quoted.discountUnits).toBe(0n);
    expect(quoted.feeUnits).toBe(want.fee);
    expect(quoted.totalUnits).toBe(want.total);

    // Over- and under-payment are refusals, not a tip and not a partial order.
    expect(await revertName(buyWithValue(sale, buyer, jazz, basket, want.total + 1n))).toBe("WrongPayment");
    expect(await revertName(buyWithValue(sale, buyer, jazz, basket, want.total - 1n))).toBe("WrongPayment");

    await buyPrimary(sale, buyer, jazz, basket);
  });

  it("ONC-020 the fee is charged on the subtotal AFTER the discount", async () => {
    const buyer = account(BUYERS[2]);
    // SAVE10 on four club seats: subtotal 10000, discount 1000, fee on 9000.
    const basket = club.seats.slice(10, 14);
    const want = expectedCost(sale, basket, RULES.events[0].discounts.SAVE10);
    expect(want.subtotal).toBe(10_000n);
    expect(want.discount).toBe(1_000n);
    expect(want.fee).toBe(9_000n / 20n + 30n); // 480, not 10000/20 + 30 = 530
    expect(want.total).toBe(9_480n);

    await buyPrimary(sale, buyer, club, basket, "SAVE10");

    // ONC-040: the organiser is owed gross minus discounts, the platform the fee.
    const ev = await sale.sale.eventOf(club.eventId);
    expect(ev.proceeds).toBe(want.subtotal - want.discount);
    expect(await sale.sale.platformProceeds()).toBe(want.fee);
  });

  it(`ONC-021 ${ruleText("ONC-021")}`, async () => {
    const cap = club.rule.wallet_cap;
    const buyer = account(BUYERS[3]);

    // One under the cap, then a basket that would take it over. The whole
    // basket must be refused — not trimmed to fit.
    await buyPrimary(sale, buyer, club, club.seats.slice(20, 20 + cap - 1));
    const over = club.seats.slice(30, 30 + 2);
    expect(await revertName(buyWithValue(sale, buyer, club, over, expectedCost(sale, over).total))).toBe(
      "WalletCapExceeded"
    );
    expect(await sale.token.balanceOf(buyer.address)).toBe(BigInt(cap - 1));
    expect(await sale.sale.primaryPurchased(club.eventId, buyer.address)).toBe(BigInt(cap - 1));

    // The last ticket up to the cap is fine; the one after it is not.
    await buyPrimary(sale, buyer, club, club.seats.slice(40, 41));
    const one = club.seats.slice(41, 42);
    expect(await revertName(buyWithValue(sale, buyer, club, one, expectedCost(sale, one).total))).toBe(
      "WalletCapExceeded"
    );

    // A whole basket bigger than the cap, in a single call, from a fresh wallet.
    const fresh = account(BUYERS[4]);
    const big = club.seats.slice(50, 50 + cap + 1);
    expect(await revertName(buyWithValue(sale, fresh, club, big, expectedCost(sale, big).total))).toBe(
      "WalletCapExceeded"
    );

    // The cap is per event: the same wallet still has its full jazz allowance.
    await buyPrimary(sale, buyer, jazz, jazz.seats.slice(0, jazz.rule.wallet_cap));
  });

  it(`ONC-022 ${ruleText("ONC-022")}`, async () => {
    const buyer = account(BUYERS[5]);
    const ev = await sale.sale.eventOf(club.eventId);

    // Open right up to the last moment before it closes.
    await setBlockTime(Number(ev.closesAt) - 100);
    await buyPrimary(sale, buyer, club, club.seats.slice(60, 61));

    // Half-open: shut AT `closesAt`, not a second later. The next block's
    // timestamp is pinned rather than mined, so this is the boundary itself.
    await setNextBlockTime(Number(ev.closesAt));
    const after = club.seats.slice(61, 62);
    expect(await revertName(buyWithValue(sale, buyer, club, after, expectedCost(sale, after).total))).toBe(
      "SaleNotOpen"
    );

    // "Before it opens" cannot be reached by moving a chain backwards, so the
    // grader registers an event of its own — it holds the platform role on the
    // replayed deployment — whose window has not started.
    const future = await registerGraderEvent(sale, { opensInSeconds: 3_600 });
    expect(
      await revertName(
        asAccount(sale, buyer).sale.buy(future.eventId, [future.tokenId], ZERO_CODE, { value: 1_030n })
      )
    ).toBe("SaleNotOpen");
  });

  it(`ONC-023 ${ruleText("ONC-023")}`, async () => {
    const buyer = account(BUYERS[6]);
    const basket = club.seats.slice(70, 71);
    const { sale: asBuyer } = asAccount(sale, buyer);
    const ids = basket.map((s) => s.tokenId);

    // A code nobody registered.
    expect(
      await revertName(
        asBuyer.buy(club.eventId, ids, discountCodeOf("NOPE"), {
          value: expectedCost(sale, basket).total,
        })
      )
    ).toBe("UnknownDiscount");

    // A code registered for a DIFFERENT event is not a code for this one.
    expect(
      await revertName(
        asAccount(sale, buyer).sale.buy(
          jazz.eventId,
          [jazz.seats[20].tokenId],
          discountCodeOf("SAVE10"),
          { value: expectedCost(sale, [jazz.seats[20]]).total }
        )
      )
    ).toBe("UnknownDiscount");
  });

  it(`ONC-041 ${ruleText("ONC-041")}`, async () => {
    const buyer = account(BUYERS[0]);
    await buyPrimary(sale, buyer, club, club.seats.slice(80, 82));

    const clubOrganizer = account(club.rule.organizer_account);
    const jazzOrganizer = account(jazz.rule.organizer_account);

    // A neighbouring organiser, the platform and a buyer are all refused.
    for (const stranger of [jazzOrganizer, sale.platform, buyer]) {
      expect(
        await revertName(asAccount(sale, stranger).sale.withdrawOrganizerProceeds(club.eventId)),
        `${stranger.address} must not be able to withdraw the club event's proceeds`
      ).toBe("OnlyOrganizer");
    }

    const owed = (await sale.sale.eventOf(club.eventId)).proceeds as bigint;
    const before = await chainProvider().getBalance(clubOrganizer.address);
    const receipt = await (
      await asAccount(sale, clubOrganizer).sale.withdrawOrganizerProceeds(club.eventId)
    ).wait();
    const after = await chainProvider().getBalance(clubOrganizer.address);
    expect(after - before + BigInt(receipt!.gasUsed) * BigInt(receipt!.gasPrice)).toBe(owed);
    expect((await sale.sale.eventOf(club.eventId)).proceeds).toBe(0n);

    // Platform parameters and the platform's own money are the platform role's.
    for (const stranger of [clubOrganizer, buyer]) {
      expect(await revertName(asAccount(sale, stranger).sale.setPlatformFee(0, 0))).toContain(
        "AccessControlUnauthorizedAccount"
      );
      expect(
        await revertName(asAccount(sale, stranger).sale.withdrawPlatformProceeds(stranger.address))
      ).toContain("AccessControlUnauthorizedAccount");
    }
    await (await sale.sale.withdrawPlatformProceeds(sale.platform.address)).wait();
    expect(await sale.sale.platformProceeds()).toBe(0n);
  });

  it(`ONC-043 ${ruleText("ONC-043")}`, async () => {
    // The books ARE zeroed, the contract's balance falls by exactly what left
    // it, and a second withdrawal finds nothing.
    const buyer = account(BUYERS[0]);
    await buyPrimary(sale, buyer, club, club.seats.slice(90, 92));

    const owed = (await sale.sale.eventOf(club.eventId)).proceeds as bigint;
    expect(owed).toBeGreaterThan(0n);
    const held = await chainProvider().getBalance(sale.saleAddress);

    const organizer = account(club.rule.organizer_account);
    await (await asAccount(sale, organizer).sale.withdrawOrganizerProceeds(club.eventId)).wait();

    expect(await chainProvider().getBalance(sale.saleAddress)).toBe(held - owed);
    expect((await sale.sale.eventOf(club.eventId)).proceeds).toBe(0n);
    expect(await sale.sale.totalOwed()).toBe(await chainProvider().getBalance(sale.saleAddress));
    expect(
      await revertName(asAccount(sale, organizer).sale.withdrawOrganizerProceeds(club.eventId))
    ).toBe("NothingOwed");
  });
});
