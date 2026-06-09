import { describe, expect, it } from "vitest";
import { loadRules, ruleText } from "./contract.js";
import { account, asAccount, freshSale, type Sale } from "./chain.js";
import { ZERO_CODE, expectedCost, eventFixtures, type EventFixture } from "./helpers.js";
import {
  ACTORS,
  POOL,
  execute,
  fc,
  newLedger,
  operations,
  propertyRun,
  readState,
  type Ledger,
} from "./model.js";

/**
 * ONC-042 and the invariants — where the signal is for this role.
 *
 * The suites either side of this one check named rules on named inputs. That is
 * necessary and it is not where on-chain code goes wrong: it goes wrong on the
 * fifth call in an order nobody wrote a test for, when a listing outlives a
 * withdrawal, or when a basket is bought twice in the same block. So the
 * statements below are not about one call. They are about every state the
 * contract can reach, and they are checked after every step of a GENERATED
 * sequence of calls:
 *
 *   INV-1 (ONC-012)  minted never exceeds the event's registered seat count
 *   INV-2 (ONC-042)  the sum of withdrawable balances never exceeds the
 *                    contract's own balance — the contract is always solvent
 *   INV-3 (ONC-011)  no seat is ever represented by two live tickets, and the
 *                    contract's own count agrees with the token's
 *   INV-4 (ONC-021)  no wallet is ever over the per-event cap, in ANY ordering
 *
 * A revert is a legitimate outcome of a generated call and never a failure of
 * the property: the point is that the invariant holds whether the call
 * succeeded or not. What would be a failure is a call that succeeds and leaves
 * the contract in a state none of the four statements above allows.
 *
 * The seed is pinned — see `propertyRun` in model.ts — so that a pass is
 * reproducible and a failure can be re-run until it is understood. Raise
 * `CHAIN_FUZZ_RUNS` to search harder; the default is tuned to finish inside a
 * grading run.
 */

const RULES = loadRules();
void RULES;

async function checkInvariants(
  sale: Sale,
  events: EventFixture[],
  ledger: Ledger,
  trail: string
): Promise<void> {
  const state = await readState(sale, events);
  const problems: string[] = [];

  if (state.owed > state.balance) {
    problems.push(
      `INV-2 (ONC-042): the contract owes ${state.owed} and holds ${state.balance}. Somebody's ` +
        `withdrawal is going to fail, and it will be whoever asks last.`
    );
  }

  for (const ev of state.events) {
    if (ev.mintedCount > ev.seatCount) {
      problems.push(
        `INV-1 (ONC-012): ${ev.fixture.rule.seed_id} has minted ${ev.mintedCount} tickets for ` +
          `${ev.seatCount} seats. Somebody has been sold a seat that does not exist.`
      );
    }
    const expectMinted = BigInt(ledger.mintedByEvent.get(ev.fixture.eventId) ?? 0);
    if (ev.mintedCount !== expectMinted) {
      problems.push(
        `INV-3 (ONC-011): ${ev.fixture.rule.seed_id} reports ${ev.mintedCount} minted, but ` +
          `${expectMinted} seats were actually sold. The contract's inventory count has drifted ` +
          `from the token's.`
      );
    }
    for (const [which, held] of ev.caps.entries()) {
      if (held > BigInt(ev.fixture.rule.wallet_cap)) {
        problems.push(
          `INV-4 (ONC-021): ${account(ACTORS[which]).address} holds ${held} primary tickets for ` +
            `${ev.fixture.rule.seed_id}, over the cap of ${ev.fixture.rule.wallet_cap}.`
        );
      }
    }
  }

  expect(problems, problems.length ? `\nafter: ${trail}\n` + problems.join("\n") : "").toEqual([]);
}

describe("onchain invariants", () => {
  it(`ONC-042 ${ruleText("ONC-042")} (pinned-seed property run)`, async () => {
    const events = eventFixtures();
    const opArb = operations(events);

    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 4, maxLength: 8 }), async (ops) => {
        const sale = await freshSale();
        const ledger = newLedger();
        const trail: string[] = [];
        await checkInvariants(sale, events, ledger, "<a freshly deployed sale>");
        for (const op of ops) {
          let outcome = "ok";
          try {
            await execute(sale, events, op, ledger);
          } catch {
            // A refusal is a legitimate outcome. The invariants have to hold
            // either way, and they are checked either way.
            outcome = "reverted";
          }
          trail.push(`${JSON.stringify(op)} -> ${outcome}`);
          await checkInvariants(sale, events, ledger, trail.join("\n       "));
        }
      }),
      propertyRun(0)
    );
  });

  it("ONC-011 every seat is represented by at most one live ticket, over a generated sale", async () => {
    const events = eventFixtures();
    const opArb = operations(events);

    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 6, maxLength: 12 }), async (ops) => {
        const sale = await freshSale();
        const ledger = newLedger();
        for (const op of ops) {
          try {
            await execute(sale, events, op, ledger);
          } catch {
            /* a refusal is fine */
          }
        }
        // Every seat in the pool: exactly the ones the harness saw minted
        // exist, each with exactly one owner. ERC-721 cannot give a token two
        // owners, so what this really catches is accounting that minted
        // without a token, or a token that exists without a sale behind it.
        const problems: string[] = [];
        const watched = events.flatMap((f) => f.seats.slice(0, POOL).map((seat) => ({ f, seat })));
        const live = await Promise.all(
          watched.map(async ({ f, seat }) => ({
            f,
            seat,
            exists: (await sale.token.exists(seat.tokenId)) as boolean,
          }))
        );
        for (const { f, seat, exists } of live) {
          const key = seat.tokenId.toString();
          if (exists !== ledger.minted.has(key)) {
            problems.push(
              `${seat.seatId}: the token ${exists ? "exists" : "does not exist"}, but the sale ` +
                `${ledger.minted.has(key) ? "did" : "did not"} sell it.`
            );
            continue;
          }
          if (!exists) continue;
          const [owner, boundTo] = await Promise.all([
            sale.token.ownerOf(seat.tokenId) as Promise<string>,
            sale.token.eventOf(seat.tokenId) as Promise<string>,
          ]);
          if (owner === "0x0000000000000000000000000000000000000000") {
            problems.push(`${seat.seatId}: a live ticket with no owner.`);
          }
          if (boundTo !== f.eventId) {
            problems.push(`${seat.seatId}: minted against the wrong event.`);
          }
        }
        expect(problems, problems.length ? "\n" + problems.join("\n") : "").toEqual([]);
      }),
      propertyRun(1, 1 / 3)
    );
  });

  it("ONC-021 no ordering of purchases takes a wallet over the per-event cap", async () => {
    const [club] = eventFixtures();
    const cap = club.rule.wallet_cap;

    await fc.assert(
      fc.asyncProperty(
        // Baskets whose sizes sum to well over the cap, in any order, bought by
        // the same wallet. If the cap is compared against the stored count
        // rather than the count the purchase would produce, one of these
        // orderings slips through and the wallet ends up above the cap.
        fc.array(fc.integer({ min: 1, max: cap + 1 }), { minLength: 2, maxLength: 5 }),
        async (sizes) => {
          const sale = await freshSale();
          const buyer = account(ACTORS[0]);
          const { sale: asBuyer } = asAccount(sale, buyer);
          let at = 0;
          for (const size of sizes) {
            const seats = club.seats.slice(at, at + size);
            at += size;
            try {
              await (
                await asBuyer.buy(club.eventId, seats.map((s) => s.tokenId), ZERO_CODE, {
                  value: expectedCost(sale, seats).total,
                })
              ).wait();
            } catch {
              /* refused, which is the expected outcome once the cap is reached */
            }
            const held = (await sale.sale.primaryPurchased(club.eventId, buyer.address)) as bigint;
            expect(
              held,
              `after baskets ${JSON.stringify(sizes)} the wallet holds ${held} of a ${cap} cap`
            ).toBeLessThanOrEqual(BigInt(cap));
            expect(await sale.token.balanceOf(buyer.address)).toBeLessThanOrEqual(BigInt(cap));
          }
        }
      ),
      propertyRun(2, 1 / 2)
    );
  });
});
