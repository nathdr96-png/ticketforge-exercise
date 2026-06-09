/**
 * The call model the property runs generate from, and the state they read back.
 *
 * It lives outside any `*.test.ts` file for the same reason
 * `conformance/infra/model.ts` does: every test file drives the contracts
 * through it, and there must be exactly one copy of "what a generated call
 * sequence can do" or they would be grading two different contracts.
 *
 * It is also where this suite's dependencies are re-exported from: a module
 * resolves its imports relative to itself, so `fast-check` and `ethers` resolve
 * here, in `conformance/blockchain/`, for any caller that imports this file.
 */

import fcLib from "fast-check";
import { ContractFactory, type Contract } from "ethers";
import fs from "node:fs";
import path from "node:path";
import { discountCodeOf, loadRules } from "./contract.js";
import { account, asAccount, chainProvider, type Sale } from "./chain.js";
import { ZERO_CODE, expectedCost, type EventFixture, type SeatFixture } from "./helpers.js";

export const fc = fcLib;

const RULES = loadRules();

/** Accounts in play. Small on purpose: the interesting sequences are the ones
 * where the same wallet comes back, not the ones where every call is a
 * stranger. */
export const ACTORS = RULES.accounts.buyers.slice(0, 4);

/** Seats in play per event. Enough to exceed a wallet cap several times over
 * and to leave seats unsold, which the uniqueness invariant needs. */
export const POOL = 10;

/**
 * Settings for a property run.
 *
 * The seed is pinned (`CHAIN_FUZZ_SEED`), so a pass is reproducible and a
 * failure can be re-run until it is understood — a fuzz run whose seed moves
 * every time is a flaky test that occasionally tells the truth. `offset` gives
 * each property its own stream without needing a second knob.
 */
export function propertyRun(offset = 0, share = 1): { seed: number; numRuns: number; endOnFailure: true } {
  const seed = Number(process.env.CHAIN_FUZZ_SEED ?? 20260108) + offset;
  const runs = Number(process.env.CHAIN_FUZZ_RUNS ?? 25);
  return { seed, numRuns: Math.max(4, Math.floor(runs * share)), endOnFailure: true };
}

export type Op =
  | { t: "buy"; actor: number; event: number; seats: number[]; discounted: boolean }
  | { t: "list"; actor: number; slot: number; overCap: boolean }
  | { t: "buyResale"; actor: number; slot: number }
  | { t: "transfer"; actor: number; to: number; slot: number }
  | { t: "withdrawOrganizer"; event: number }
  | { t: "withdrawPlatform" }
  | { t: "withdrawSeller"; actor: number };

export function operations(events: EventFixture[]): import("fast-check").Arbitrary<Op> {
  const actor = fc.integer({ min: 0, max: ACTORS.length - 1 });
  const event = fc.integer({ min: 0, max: events.length - 1 });
  const slot = fc.integer({ min: 0, max: POOL * events.length - 1 });
  return fc.oneof(
    // Weighted towards buying: an empty contract has few interesting states,
    // and most of the invariants are about money that arrived.
    {
      weight: 6,
      arbitrary: fc.record({
        t: fc.constant("buy" as const),
        actor,
        event,
        seats: fc.uniqueArray(fc.integer({ min: 0, max: POOL - 1 }), { minLength: 1, maxLength: 5 }),
        discounted: fc.boolean(),
      }),
    },
    { weight: 3, arbitrary: fc.record({ t: fc.constant("list" as const), actor, slot, overCap: fc.boolean() }) },
    { weight: 3, arbitrary: fc.record({ t: fc.constant("buyResale" as const), actor, slot }) },
    { weight: 2, arbitrary: fc.record({ t: fc.constant("transfer" as const), actor, to: actor, slot }) },
    { weight: 2, arbitrary: fc.record({ t: fc.constant("withdrawOrganizer" as const), event }) },
    { weight: 1, arbitrary: fc.record({ t: fc.constant("withdrawPlatform" as const) }) },
    { weight: 2, arbitrary: fc.record({ t: fc.constant("withdrawSeller" as const), actor }) }
  );
}

/** What the harness believes about the chain, so an invariant has something to
 * compare the contract's own counters against. */
export interface Ledger {
  minted: Map<string, string>;
  mintedByEvent: Map<string, number>;
  /** Everything a buyer has sent to the contract, less everything paid out. */
  netIn: bigint;
}

export function newLedger(): Ledger {
  return { minted: new Map(), mintedByEvent: new Map(), netIn: 0n };
}

export async function execute(sale: Sale, events: EventFixture[], op: Op, ledger: Ledger): Promise<void> {
  const pool = events.flatMap((f) => f.seats.slice(0, POOL).map((s) => ({ fixture: f, seat: s })));
  const pick = (slot: number) => pool[slot % pool.length];

  switch (op.t) {
    case "buy": {
      const fixture = events[op.event];
      const seats: SeatFixture[] = op.seats.map((i) => fixture.seats[i]);
      const code = op.discounted ? Object.keys(fixture.rule.discounts)[0] : undefined;
      const percentOff = code ? fixture.rule.discounts[code] : 0;
      const { total } = expectedCost(sale, seats, percentOff);
      const who = account(ACTORS[op.actor]);
      const { sale: asBuyer } = asAccount(sale, who);
      await (
        await asBuyer.buy(
          fixture.eventId,
          seats.map((s) => s.tokenId),
          code ? discountCodeOf(code) : ZERO_CODE,
          { value: total }
        )
      ).wait();
      for (const seat of seats) ledger.minted.set(seat.tokenId.toString(), who.address);
      ledger.mintedByEvent.set(
        fixture.eventId,
        (ledger.mintedByEvent.get(fixture.eventId) ?? 0) + seats.length
      );
      return;
    }
    case "list": {
      const { seat, fixture } = pick(op.slot);
      const who = account(ACTORS[op.actor]);
      const { sale: asHolder, token } = asAccount(sale, who);
      const ceiling = (seat.price * BigInt(fixture.rule.resale_cap_bps)) / 10_000n;
      await (await token.approve(sale.saleAddress, seat.tokenId)).wait();
      await (await asHolder.listForResale(seat.tokenId, op.overCap ? ceiling + 1n : ceiling)).wait();
      return;
    }
    case "buyResale": {
      const { seat } = pick(op.slot);
      const { sale: asBuyer } = asAccount(sale, account(ACTORS[op.actor]));
      const price = (await sale.sale.listingPrice(seat.tokenId)) as bigint;
      await (await asBuyer.buyResale(seat.tokenId, { value: price })).wait();
      return;
    }
    case "transfer": {
      const { seat } = pick(op.slot);
      const from = account(ACTORS[op.actor]);
      const { token } = asAccount(sale, from);
      await (await token.transferFrom(from.address, account(ACTORS[op.to]).address, seat.tokenId)).wait();
      return;
    }
    case "withdrawOrganizer": {
      const fixture = events[op.event];
      const organizer = account(fixture.rule.organizer_account);
      await (await asAccount(sale, organizer).sale.withdrawOrganizerProceeds(fixture.eventId)).wait();
      return;
    }
    case "withdrawPlatform": {
      await (await sale.sale.withdrawPlatformProceeds(sale.platform.address)).wait();
      return;
    }
    case "withdrawSeller": {
      const who = account(ACTORS[op.actor]);
      await (await asAccount(sale, who).sale.withdrawSellerProceeds()).wait();
      return;
    }
  }
}

export interface ChainState {
  owed: bigint;
  balance: bigint;
  events: { fixture: EventFixture; mintedCount: bigint; seatCount: bigint; proceeds: bigint; caps: bigint[] }[];
}

/**
 * Everything an invariant needs, in one batch of round trips.
 *
 * Issued together rather than one after another: a property run makes a few
 * hundred of these, and sequential reads against a local node are the entire
 * wall time of one.
 */
export async function readState(sale: Sale, events: EventFixture[]): Promise<ChainState> {
  const contract: Contract = sale.sale;
  const [owed, balance, states, caps] = await Promise.all([
    contract.totalOwed() as Promise<bigint>,
    chainProvider().getBalance(sale.saleAddress),
    Promise.all(events.map((f) => contract.eventOf(f.eventId))),
    Promise.all(
      events.map((f) =>
        Promise.all(
          ACTORS.map((i) => contract.primaryPurchased(f.eventId, account(i).address) as Promise<bigint>)
        )
      )
    ),
  ]);
  return {
    owed,
    balance,
    events: events.map((fixture, at) => ({
      fixture,
      mintedCount: BigInt(states[at].mintedCount),
      seatCount: BigInt(states[at].seatCount),
      proceeds: BigInt(states[at].proceeds),
      caps: caps[at],
    })),
  };
}

/**
 * Deploy a withdrawal recipient that calls back (attacker/ReentrantOrganizer.sol).
 *
 * The creation bytecode is vendored in `attacker/ReentrantOrganizer.json`, so
 * nothing here needs a Solidity compiler and nothing needs the network.
 */
export async function deployReentrantOrganizer(sale: Sale): Promise<Contract> {
  const file = path.join(import.meta.dirname, "attacker", "ReentrantOrganizer.json");
  const artifact = JSON.parse(fs.readFileSync(file, "utf8")) as { abi: unknown[]; bytecode: string };
  const factory = new ContractFactory(artifact.abi as never, artifact.bytecode, sale.platform);
  const deployed = await factory.deploy(sale.saleAddress);
  await deployed.waitForDeployment();
  return deployed as Contract;
}
