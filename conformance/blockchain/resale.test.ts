import { beforeEach, describe, expect, it } from "vitest";
import { loadRules, ruleText } from "./contract.js";
import { account, asAccount, chainProvider, freshSale, revertName, type Sale } from "./chain.js";
import { approveAndList, buyPrimary, fixtureFor, listWithoutWaiting, type EventFixture } from "./helpers.js";

/**
 * ONC-030 and ONC-031 — the capped resale.
 *
 * This is the reason an organiser asks for a ticket on chain at all, so it is
 * worth being precise about what is and is not asserted here. The cap binds
 * resales that go through the contract. Two wallets transferring a ticket and
 * settling in cash is outside what any on-chain rule can see, and
 * `contract/onchain/rules.yaml` says so under ONC-030's `limitation` rather
 * than leaving a reader to assume more than the chain can deliver.
 */

const RULES = loadRules();
const BUYERS = RULES.accounts.buyers;

describe("onchain resale", () => {
  let sale: Sale;
  let club: EventFixture;

  beforeEach(async () => {
    sale = await freshSale();
    club = fixtureFor("event_club_100");
  });

  it(`ONC-030 ${ruleText("ONC-030")}`, async () => {
    const holder = account(BUYERS[0]);
    const seat = club.seats[0];
    await buyPrimary(sale, holder, club, [seat]);

    // 110% of a 2500 face value is 2750.
    const ceiling = (seat.price * BigInt(club.rule.resale_cap_bps)) / 10_000n;
    expect(ceiling).toBe(2_750n);
    expect(await sale.sale.resaleCeiling(seat.tokenId)).toBe(ceiling);

    const { sale: asHolder, token } = asAccount(sale, holder);
    await (await token.approve(sale.saleAddress, seat.tokenId)).wait();

    // One unit above the cap is refused. Ten times face value — the complaint
    // in the ticket — is refused by a very long way.
    expect(await revertName(asHolder.listForResale(seat.tokenId, ceiling + 1n))).toBe("ResaleAboveCap");
    expect(await revertName(asHolder.listForResale(seat.tokenId, seat.price * 10n))).toBe("ResaleAboveCap");
    expect(await sale.sale.listingPrice(seat.tokenId)).toBe(0n);

    // At the cap exactly, it is allowed: the rule is a ceiling, not a gap.
    await (await asHolder.listForResale(seat.tokenId, ceiling)).wait();
    expect(await sale.sale.listingPrice(seat.tokenId)).toBe(ceiling);
    expect(await sale.sale.listingSeller(seat.tokenId)).toBe(holder.address);

    // And a plain transfer, with no price attached, is still allowed: the rule
    // is against scalping, not against giving a friend your ticket.
    const friend = account(BUYERS[1]);
    const gift = club.seats[1];
    await buyPrimary(sale, holder, club, [gift]);
    await (await token.transferFrom(holder.address, friend.address, gift.tokenId)).wait();
    expect(await sale.token.ownerOf(gift.tokenId)).toBe(friend.address);
  });

  it("ONC-030 an event whose cap is 100% of face value allows no mark-up at all", async () => {
    const jazz = fixtureFor("event_jazz_eur");
    expect(jazz.rule.resale_cap_bps).toBe(10_000);
    const holder = account(BUYERS[2]);
    const seat = jazz.seats.find((s) => s.section === "A")!;
    await buyPrimary(sale, holder, jazz, [seat]);

    const { sale: asHolder, token } = asAccount(sale, holder);
    await (await token.approve(sale.saleAddress, seat.tokenId)).wait();
    expect(await revertName(asHolder.listForResale(seat.tokenId, seat.price + 1n))).toBe("ResaleAboveCap");
    await (await asHolder.listForResale(seat.tokenId, seat.price)).wait();
  });

  it("ONC-030 only the holder can list, and only with the sale approved", async () => {
    const holder = account(BUYERS[3]);
    const seat = club.seats[5];
    await buyPrimary(sale, holder, club, [seat]);

    const stranger = account(BUYERS[4]);
    expect(await revertName(listWithoutWaiting(sale, stranger, seat.tokenId, 1n))).toBe("NotOwner");
    // The holder has not approved the sale to move the token, so a listing
    // would be an offer it cannot honour.
    expect(await revertName(listWithoutWaiting(sale, holder, seat.tokenId, 1n))).toBe("NotApproved");
  });

  it(`ONC-031 ${ruleText("ONC-031")}`, async () => {
    const seller = account(BUYERS[0]);
    const buyer = account(BUYERS[1]);
    const seat = club.seats[10];
    await buyPrimary(sale, seller, club, [seat]);

    const price = (seat.price * BigInt(club.rule.resale_cap_bps)) / 10_000n;
    await approveAndList(sale, seller, seat.tokenId, price);

    const sellerBefore = await chainProvider().getBalance(seller.address);
    const contractBefore = await chainProvider().getBalance(sale.saleAddress);

    const { sale: asBuyer } = asAccount(sale, buyer);
    // Exact payment, like the primary sale.
    expect(await revertName(asBuyer.buyResale(seat.tokenId, { value: price - 1n }))).toBe("WrongPayment");
    await (await asBuyer.buyResale(seat.tokenId, { value: price })).wait();

    expect(await sale.token.ownerOf(seat.tokenId)).toBe(buyer.address);
    // Credited, not pushed: the seller's own balance has not moved, and the
    // money is sitting in the contract with their name on it.
    expect(await chainProvider().getBalance(seller.address)).toBe(sellerBefore);
    expect(await sale.sale.sellerProceeds(seller.address)).toBe(price);
    expect(await chainProvider().getBalance(sale.saleAddress)).toBe(contractBefore + price);

    // The listing is gone, so the same ticket cannot be sold twice.
    expect(await sale.sale.listingSeller(seat.tokenId)).toBe(
      "0x0000000000000000000000000000000000000000"
    );
    expect(await revertName(asBuyer.buyResale(seat.tokenId, { value: price }))).toBe("NotListed");

    // And the seller can pull what they are owed, once.
    const { sale: asSeller } = asAccount(sale, seller);
    await (await asSeller.withdrawSellerProceeds()).wait();
    expect(await sale.sale.sellerProceeds(seller.address)).toBe(0n);
    expect(await revertName(asSeller.withdrawSellerProceeds())).toBe("NothingOwed");

    // A resale moves no money to the organiser or the platform: the organiser
    // was paid for this seat once, on the primary sale, and a second credit
    // here is money the contract does not have.
    const ev = await sale.sale.eventOf(club.eventId);
    expect(ev.proceeds).toBe(seat.price);
  });
});
