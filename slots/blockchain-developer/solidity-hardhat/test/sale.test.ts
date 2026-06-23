/**
 * The slot's own tests.
 *
 * These are not the grade. `conformance/blockchain` is, and it never imports
 * anything from this directory. What these are for is the thing a candidate
 * does before opening a pull request: they run in seconds against a fresh
 * in-process chain, and they cover the rules it is easy to break while editing
 * — the money order of operations, the two caps, the window, and the ordering
 * inside a withdrawal.
 *
 * Deliberately NOT a copy of the conformance suite. A slot whose tests are the
 * grader's tests teaches a candidate to tune for the grader.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { Contract } from "ethers";

/**
 * A contract handle whose methods are reachable by name.
 *
 * typechain is deliberately not in this slot's dependencies: adding a code
 * generator so that a test file can have nicer types would put a build step
 * between a candidate and their first green run. ethers' own `Contract` carries
 * no method types without it, so the handles are widened here, in one place.
 */
type Callable = Contract & { [member: string]: any };

/** `contract.connect(signer)` widened back to a callable handle. */
const as = (contract: Callable, who: HardhatEthersSigner): Callable =>
  contract.connect(who) as Callable;

const FEE_PERCENT = 5n;
const FEE_FIXED = 30n;
const CLUB = ethers.id("event_club_100");
const SECTION_A_PRICE = 2_500n;
const WALLET_CAP = 4;
const RESALE_CAP_BPS = 11_000;

function seat(n: number): bigint {
  return BigInt(ethers.id(`seat_club_A01-${String(n).padStart(2, "0")}`));
}

function cost(seats: number, percentOff = 0n): bigint {
  const subtotal = SECTION_A_PRICE * BigInt(seats);
  const discount = (subtotal * percentOff) / 100n;
  const fee = ((subtotal - discount) * FEE_PERCENT) / 100n + FEE_FIXED;
  return subtotal - discount + fee;
}

describe("PrimarySale", () => {
  // Typed loosely on purpose: typechain is not in this slot's dependency list,
  // and adding a code generator so that a test file can have nicer types would
  // put a build step between a candidate and their first green run.
  let sale: Callable;
  let token: Callable;
  let platform: HardhatEthersSigner;
  let organizer: HardhatEthersSigner;
  let buyer: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  beforeEach(async () => {
    [platform, organizer, buyer, other] = await ethers.getSigners();
    const Sale = await ethers.getContractFactory("PrimarySale");
    sale = (await Sale.deploy(platform.address, FEE_PERCENT, FEE_FIXED)) as unknown as Callable;
    const Token = await ethers.getContractFactory("TicketToken");
    token = (await Token.deploy(await sale.getAddress())) as unknown as Callable;
    await sale.setTicketToken(await token.getAddress());

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await sale.registerEvent(CLUB, organizer.address, now - 10, now + 1_000_000, WALLET_CAP, RESALE_CAP_BPS, [
      SECTION_A_PRICE,
    ]);
    await sale.registerSeats(
      CLUB,
      Array.from({ length: 10 }, (_, i) => seat(i + 1)),
      Array.from({ length: 10 }, () => 0)
    );
    await sale.registerDiscount(CLUB, ethers.id("SAVE10"), 10);
    await sale.sealEvent(CLUB);
  });

  it("quotes the product's fee on the post-discount subtotal", async () => {
    const q = await sale.quote(CLUB, [seat(1), seat(2)], ethers.id("SAVE10"));
    expect(q.subtotalUnits).to.equal(5_000n);
    expect(q.discountUnits).to.equal(500n);
    expect(q.feeUnits).to.equal(4_500n / 20n + FEE_FIXED); // 255, not 280
    expect(q.totalUnits).to.equal(4_755n);
  });

  it("refuses an inexact payment", async () => {
    await expect(
      as(sale, buyer).buy(CLUB, [seat(1)], ethers.ZeroHash, { value: cost(1) + 1n })
    ).to.be.revertedWithCustomError(sale, "WrongPayment");
  });

  it("splits a purchase between the organizer and the platform", async () => {
    await as(sale, buyer).buy(CLUB, [seat(1), seat(2)], ethers.ZeroHash, { value: cost(2) });
    const ev = await sale.eventOf(CLUB);
    expect(ev.proceeds).to.equal(5_000n);
    expect(await sale.platformProceeds()).to.equal(5_000n / 20n + FEE_FIXED);
    expect(await sale.totalOwed()).to.equal(await ethers.provider.getBalance(await sale.getAddress()));
  });

  it("caps a wallet on the count the purchase would produce, not the count it has", async () => {
    await as(sale, buyer).buy(CLUB, [seat(1), seat(2), seat(3)], ethers.ZeroHash, { value: cost(3) });
    await expect(
      as(sale, buyer).buy(CLUB, [seat(4), seat(5)], ethers.ZeroHash, { value: cost(2) })
    ).to.be.revertedWithCustomError(sale, "WalletCapExceeded");
    await as(sale, buyer).buy(CLUB, [seat(4)], ethers.ZeroHash, { value: cost(1) });
    expect(await token.balanceOf(buyer.address)).to.equal(BigInt(WALLET_CAP));
  });

  it("will not sell the same seat twice", async () => {
    await as(sale, buyer).buy(CLUB, [seat(1)], ethers.ZeroHash, { value: cost(1) });
    await expect(
      as(sale, other).buy(CLUB, [seat(1)], ethers.ZeroHash, { value: cost(1) })
    ).to.be.reverted;
  });

  it("closes the sale at closesAt, not a second later", async () => {
    const ev = await sale.eventOf(CLUB);
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(ev.closesAt)]);
    await expect(
      as(sale, buyer).buy(CLUB, [seat(1)], ethers.ZeroHash, { value: cost(1) })
    ).to.be.revertedWithCustomError(sale, "SaleNotOpen");
  });

  it("caps a resale against what was paid for that seat", async () => {
    await as(sale, buyer).buy(CLUB, [seat(1)], ethers.ZeroHash, { value: cost(1) });
    const ceiling = (SECTION_A_PRICE * BigInt(RESALE_CAP_BPS)) / 10_000n;
    expect(await sale.resaleCeiling(seat(1))).to.equal(ceiling);

    await as(token, buyer).approve(await sale.getAddress(), seat(1));
    await expect(
      as(sale, buyer).listForResale(seat(1), ceiling + 1n)
    ).to.be.revertedWithCustomError(sale, "ResaleAboveCap");
    await as(sale, buyer).listForResale(seat(1), ceiling);

    await as(sale, other).buyResale(seat(1), { value: ceiling });
    expect(await token.ownerOf(seat(1))).to.equal(other.address);
    // Credited, not pushed.
    expect(await sale.sellerProceeds(buyer.address)).to.equal(ceiling);
  });

  it("lets only the event's organizer withdraw its proceeds", async () => {
    await as(sale, buyer).buy(CLUB, [seat(1)], ethers.ZeroHash, { value: cost(1) });
    await expect(as(sale, other).withdrawOrganizerProceeds(CLUB)).to.be.revertedWithCustomError(
      sale,
      "OnlyOrganizer"
    );
    await expect(as(sale, platform).withdrawOrganizerProceeds(CLUB)).to.be.revertedWithCustomError(
      sale,
      "OnlyOrganizer"
    );
    await as(sale, organizer).withdrawOrganizerProceeds(CLUB);
    expect((await sale.eventOf(CLUB)).proceeds).to.equal(0n);
  });

  it("lets only the platform role change platform parameters", async () => {
    await expect(as(sale, organizer).setPlatformFee(0, 0)).to.be.revertedWithCustomError(
      sale,
      "AccessControlUnauthorizedAccount"
    );
    await sale.setPlatformFee(7, 50);
    expect(await sale.feePercent()).to.equal(7n);
  });

  it("zeroes the books before paying out, so a re-entrant withdrawal gets nothing twice", async () => {
    // The whole safety property of a withdrawal is the order of two lines, so
    // it gets a test with a recipient that really calls back.
    const Attacker = await ethers.getContractFactory("ReentrantReceiver");
    const attacker = (await Attacker.deploy(await sale.getAddress())) as unknown as Callable;
    const attackerAddress = await attacker.getAddress();

    const rogue = ethers.id("rogue_event");
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await sale.registerEvent(rogue, attackerAddress, now - 10, now + 1_000_000, 10, 10_000, [1_000n]);
    const rogueSeat = BigInt(ethers.id("rogue_seat_1"));
    await sale.registerSeats(rogue, [rogueSeat], [0]);
    await sale.sealEvent(rogue);

    // Money that belongs to somebody else, for the attacker to try to reach.
    await as(sale, buyer).buy(CLUB, [seat(1), seat(2)], ethers.ZeroHash, { value: cost(2) });
    await as(sale, other).buy(rogue, [rogueSeat], ethers.ZeroHash, { value: 1_000n + 1_000n / 20n + FEE_FIXED });

    const owedToAttacker = (await sale.eventOf(rogue)).proceeds;
    await attacker.arm(sale.interface.encodeFunctionData("withdrawOrganizerProceeds", [rogue]), 3);
    await attacker.fire();

    expect(await ethers.provider.getBalance(attackerAddress)).to.equal(owedToAttacker);
    expect(await sale.totalOwed()).to.be.lte(
      await ethers.provider.getBalance(await sale.getAddress())
    );
    expect((await sale.eventOf(CLUB)).proceeds).to.equal(5_000n);
  });
});
