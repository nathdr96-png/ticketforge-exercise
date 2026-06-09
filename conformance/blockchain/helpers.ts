/**
 * Fixture plumbing shared by every test in this family.
 *
 * There is exactly one copy of this on purpose: every test must agree about
 * what a seat costs and which token id it has, or they would be grading two
 * different readings of the same seed file.
 */

import { type Contract, id as keccakUtf8 } from "ethers";
import {
  type OnchainEventRule,
  discountCodeOf,
  eventIdOf,
  loadRules,
  quoteMoney,
  seatPrice,
  seatsForEvent,
  sectionIndex,
  tokenIdOf,
} from "./contract.js";
import { type Sale, type Signer, account, asAccount, chainProvider } from "./chain.js";

export const ZERO_CODE = "0x" + "00".repeat(32);

export interface SeatFixture {
  seatId: string;
  tokenId: bigint;
  section: string;
  sectionIndex: number;
  price: bigint;
}

export interface EventFixture {
  rule: OnchainEventRule;
  eventId: string;
  seats: SeatFixture[];
}

export function eventFixtures(): EventFixture[] {
  return loadRules().events.map((rule) => ({
    rule,
    eventId: eventIdOf(rule.seed_id),
    seats: seatsForEvent(rule.seed_id).map((seat) => ({
      seatId: seat.id,
      tokenId: tokenIdOf(seat.id),
      section: seat.section,
      sectionIndex: sectionIndex(rule, seat.section),
      price: seatPrice(rule, seat.section),
    })),
  }));
}

export function fixtureFor(seedId: string): EventFixture {
  const found = eventFixtures().find((f) => f.rule.seed_id === seedId);
  if (!found) throw new Error(`${seedId} is not an on-chain event in contract/onchain/rules.yaml`);
  return found;
}

export function feeParameters(sale: Sale): { percent: number; fixed: bigint } {
  return { percent: sale.deployment.fee.percent, fixed: BigInt(sale.deployment.fee.fixed_units) };
}

/** What this basket should cost, computed from the seed and the product's rule. */
export function expectedCost(
  sale: Sale,
  seats: SeatFixture[],
  percentOff = 0
): { subtotal: bigint; discount: bigint; fee: bigint; total: bigint } {
  const subtotal = seats.reduce((acc, s) => acc + s.price, 0n);
  const { percent, fixed } = feeParameters(sale);
  return quoteMoney(subtotal, percentOff, percent, fixed);
}

export async function buyPrimary(
  sale: Sale,
  buyer: Signer,
  fixture: EventFixture,
  seats: SeatFixture[],
  code?: string
): Promise<void> {
  const percentOff = code ? (fixture.rule.discounts[code] ?? 0) : 0;
  const { total } = expectedCost(sale, seats, percentOff);
  const { sale: asBuyer } = asAccount(sale, buyer);
  const tx = await asBuyer.buy(
    fixture.eventId,
    seats.map((s) => s.tokenId),
    code ? discountCodeOf(code) : ZERO_CODE,
    { value: total }
  );
  await tx.wait();
}

/** `sale.buy(...)` with the value the caller chooses, for refusal tests. */
export function buyWithValue(
  sale: Sale,
  buyer: Signer,
  fixture: EventFixture,
  seats: SeatFixture[],
  value: bigint,
  code?: string
): Promise<unknown> {
  const { sale: asBuyer } = asAccount(sale, buyer);
  return asBuyer.buy(
    fixture.eventId,
    seats.map((s) => s.tokenId),
    code ? discountCodeOf(code) : ZERO_CODE,
    { value }
  );
}

export async function approveAndList(
  sale: Sale,
  owner: Signer,
  tokenId: bigint,
  price: bigint
): Promise<void> {
  const { sale: asOwner, token } = asAccount(sale, owner);
  await (await token.approve(sale.saleAddress, tokenId)).wait();
  await (await asOwner.listForResale(tokenId, price)).wait();
}

export function listWithoutWaiting(sale: Sale, owner: Signer, tokenId: bigint, price: bigint): Promise<unknown> {
  const { sale: asOwner } = asAccount(sale, owner);
  return asOwner.listForResale(tokenId, price);
}

/** Everything the contract still owes, read back off the chain. */
export async function totalOwed(sale: Contract): Promise<bigint> {
  return (await sale.totalOwed()) as bigint;
}

/**
 * Register an event of the grader's own.
 *
 * The grader replayed the deployment, so it holds the platform role — which is
 * what makes it possible to test a window that has not opened yet, or an
 * organizer that is a contract. The event has one section priced at 1000 units
 * and one seat, and it exists only inside the snapshot the calling test is
 * holding.
 */
export async function registerGraderEvent(
  sale: Sale,
  opts: { opensInSeconds?: number; organizer?: string; resaleCapBps?: number; label?: string } = {}
): Promise<{ eventId: string; tokenId: bigint; price: bigint }> {
  const label = opts.label ?? `grader_event_${Math.random().toString(36).slice(2, 10)}`;
  const eventId = keccakUtf8(label);
  const tokenId = BigInt(keccakUtf8(`${label}_seat_1`));
  const now = (await chainProvider().getBlock("latest"))!.timestamp;
  const opensAt = now + (opts.opensInSeconds ?? -1);
  await (
    await sale.sale.registerEvent(
      eventId,
      opts.organizer ?? account(1).address,
      opensAt,
      opensAt + 10_000_000,
      10,
      opts.resaleCapBps ?? 10_000,
      [1_000n]
    )
  ).wait();
  await (await sale.sale.registerSeats(eventId, [tokenId], [0])).wait();
  await (await sale.sale.sealEvent(eventId)).wait();
  return { eventId, tokenId, price: 1_000n };
}
