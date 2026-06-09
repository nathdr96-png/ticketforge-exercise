import { beforeAll, describe, expect, it } from "vitest";
import { Fragment } from "ethers";
import {
  declaredInterface,
  eventIdOf,
  loadDeployment,
  loadRules,
  ruleText,
  unixSeconds,
} from "./contract.js";
import { account, chainProvider, freshSale, replayDeployment, type Sale } from "./chain.js";
import { eventFixtures } from "./helpers.js";

/**
 * ONC-001..ONC-003 — the interface between an implementation and its grade.
 *
 * This file is the one that justifies the family's claim to be stack-agnostic:
 * it takes a declaration of a deployment, replays it onto a chain the grader
 * started, and proves the declaration was complete and honest. Everything
 * afterwards drives the contracts that came out of that replay.
 */

const RULES = loadRules();

function fail(problems: string[]): void {
  expect(problems, problems.length ? "\n" + problems.join("\n") : "").toEqual([]);
}

describe("onchain deployment", () => {
  it(`ONC-001 ${ruleText("ONC-001")}`, async () => {
    const { sale, problems } = await replayDeployment();
    fail(problems);
    expect(sale, "replay produced no sale contract").not.toBeNull();
  });

  it("ONC-001 the declared ABI presents every function and event the contract requires", () => {
    const deployment = loadDeployment();
    const problems: string[] = [];
    for (const name of ["PrimarySale", "TicketToken"] as const) {
      const required = declaredInterface(name);
      const declared = deployment.contracts[name]?.abi;
      if (!declared) {
        problems.push(`${name}: the deployment file declares no ABI for it`);
        continue;
      }
      const have = new Set<string>();
      for (const item of declared as unknown[]) {
        try {
          const fragment = Fragment.from(item as never);
          if (fragment.type === "function" || fragment.type === "event") {
            have.add(fragment.format("sighash"));
          }
        } catch {
          // An unparseable ABI entry is not itself a failure; a missing
          // required one below is.
        }
      }
      for (const fragment of required.fragments) {
        if (fragment.type !== "function" && fragment.type !== "event") continue;
        const sig = fragment.format("sighash");
        if (!have.has(sig)) {
          problems.push(
            `${name}: the deployed contract does not present \`${sig}\`, which ` +
              `contract/onchain/abi/${name}.json requires. The grader encodes its calls ` +
              `against that file, so a renamed function is ungradable for the same reason ` +
              `a backend that renames POST /orders is.`
          );
        }
      }
    }
    fail(problems);
  });

  it(`ONC-002 ${ruleText("ONC-002")}`, () => {
    const deployment = loadDeployment();
    const problems: string[] = [];
    // 31337 is Hardhat Network's, 1337 is the older local default. A chain id
    // belonging to a public network means the deployment was aimed somewhere
    // this suite must never need.
    if (![31337, 1337].includes(deployment.chain.id)) {
      problems.push(
        `the deployment declares chain id ${deployment.chain.id}, which is not a local ` +
          `development chain. Nothing in this family may need an internet RPC endpoint, ` +
          `a faucet or a fork.`
      );
    }
    // A deployer that is not one of the standard local accounts means a key
    // came from somewhere — an environment variable, a keystore, a wallet.
    const known = new Set<string>();
    for (let i = 0; i < 20; i++) known.add(account(i).address.toLowerCase());
    if (!known.has(deployment.deployer.toLowerCase())) {
      problems.push(
        `the deployer ${deployment.deployer} is not one of the first 20 accounts of the ` +
          `standard local mnemonic. contract/onchain/rules.yaml fixes the role accounts so ` +
          `that no private key is ever read from the environment.`
      );
    }
    fail(problems);
  });

  describe("ONC-003 the seeded events", () => {
    let sale: Sale;
    beforeAll(async () => {
      sale = await freshSale();
    });

    it(`ONC-003 ${ruleText("ONC-003")}`, async () => {
      const problems: string[] = [];
      const opensAt = BigInt(unixSeconds(RULES.sale_window.opens_at));
      const closesAt = BigInt(unixSeconds(RULES.sale_window.closes_at));

      for (const fixture of eventFixtures()) {
        const ev = await sale.sale.eventOf(fixture.eventId);
        const want = sale.deployment.roles[fixture.rule.seed_id];
        const organizerAccount = account(fixture.rule.organizer_account).address;

        if (ev.organizer === "0x0000000000000000000000000000000000000000") {
          problems.push(`${fixture.rule.seed_id} is not registered on chain at all`);
          continue;
        }
        if (ev.organizer.toLowerCase() !== organizerAccount.toLowerCase()) {
          problems.push(
            `${fixture.rule.seed_id}: organizer on chain is ${ev.organizer}, but ` +
              `contract/onchain/rules.yaml maps its seeded organizer to account ` +
              `${fixture.rule.organizer_account} (${organizerAccount})` +
              (want ? ` and the deployment file itself declares ${want}` : "")
          );
        }
        if (ev.opensAt !== opensAt || ev.closesAt !== closesAt) {
          problems.push(
            `${fixture.rule.seed_id}: sale window on chain is [${ev.opensAt}, ${ev.closesAt}), ` +
              `but rules.yaml declares [${opensAt}, ${closesAt}).`
          );
        }
        if (BigInt(ev.walletCap) !== BigInt(fixture.rule.wallet_cap)) {
          problems.push(
            `${fixture.rule.seed_id}: wallet cap on chain is ${ev.walletCap}, rules.yaml says ` +
              `${fixture.rule.wallet_cap}.`
          );
        }
        if (BigInt(ev.resaleCapBps) !== BigInt(fixture.rule.resale_cap_bps)) {
          problems.push(
            `${fixture.rule.seed_id}: resale cap on chain is ${ev.resaleCapBps} bps, rules.yaml ` +
              `says ${fixture.rule.resale_cap_bps} bps.`
          );
        }
        if (BigInt(ev.seatCount) !== BigInt(fixture.seats.length)) {
          problems.push(
            `${fixture.rule.seed_id}: ${ev.seatCount} seats registered, but ` +
              `contract/seed/seats.json has ${fixture.seats.length}.`
          );
        }
        if (!ev.isSealed) {
          problems.push(
            `${fixture.rule.seed_id}: the event is not sealed, so its seat count can still ` +
              `change and ONC-012 means nothing.`
          );
        }

        // Prices come from the seed, per section, and the suite checks every
        // seat rather than one per section: a section index that is off by one
        // prices half the room wrongly and is invisible in a spot check.
        const prices = new Map<number, bigint>();
        for (const index of new Set(fixture.seats.map((s) => s.sectionIndex))) {
          prices.set(index, (await sale.sale.sectionPrice(fixture.eventId, index)) as bigint);
        }
        // One round trip per seat, issued together: 200 sequential reads over
        // JSON-RPC is most of this suite's wall time otherwise.
        const registrations = await Promise.all(
          fixture.seats.map((seat) => sale.sale.seatOf(seat.tokenId))
        );
        for (const [at, seat] of fixture.seats.entries()) {
          const onChain = prices.get(seat.sectionIndex);
          if (onChain !== seat.price) {
            problems.push(
              `${seat.seatId}: section ${seat.section} is priced ${onChain} on chain, but ` +
                `contract/seed/seats.json says ${seat.price}.`
            );
            break;
          }
          const registered = registrations[at];
          if (!registered.registered) {
            problems.push(`${seat.seatId} (token ${seat.tokenId}) is not registered on chain.`);
            break;
          }
          if (registered.eventId !== fixture.eventId) {
            problems.push(`${seat.seatId} is registered against the wrong event.`);
            break;
          }
          if (BigInt(registered.section) !== BigInt(seat.sectionIndex)) {
            problems.push(
              `${seat.seatId} is registered in section index ${registered.section}, expected ` +
                `${seat.sectionIndex} (section ${seat.section}).`
            );
            break;
          }
        }
      }

      for (const seedId of RULES.not_on_chain) {
        const ev = await sale.sale.eventOf(eventIdOf(seedId));
        if (ev.organizer !== "0x0000000000000000000000000000000000000000") {
          problems.push(
            `${seedId} is registered on chain, but contract/onchain/rules.yaml lists it under ` +
              `not_on_chain. It is either unpublished, cancelled, or deliberately out of scope.`
          );
        }
      }

      fail(problems);
    });

    it("ONC-002 the grader's chain is local and the replay needed no network", async () => {
      const network = await chainProvider().getNetwork();
      expect([31337n, 1337n]).toContain(network.chainId);
      expect(await chainProvider().getBlockNumber()).toBeGreaterThan(0);
    });
  });
});
