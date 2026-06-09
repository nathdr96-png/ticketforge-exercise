/**
 * The on-chain contract, loaded.
 *
 * Nothing in this file knows what built the thing under test. The suite reads
 * `contract/onchain/rules.yaml` for the rules, `contract/onchain/abi/` for the
 * interface every implementation has to present, `contract/seed/` for seat and
 * event identity, and whatever an implementation declared in
 * `$CHAIN_DEPLOYMENT` — then replays that declaration onto a chain the grader
 * owns. A Solidity/Hardhat slot, a Foundry slot and a Vyper slot are graded by
 * exactly the same bar, in the same way `conformance/data` grades SQL, dbt and
 * pandas by comparing result files.
 */

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { id as keccakUtf8, Interface } from "ethers";

export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
export const SUITE_DIR = import.meta.dirname;

// ------------------------------------------------------------------ the rules

export interface OnchainEventRule {
  seed_id: string;
  organizer_account: number;
  sections: Record<string, number>;
  seat_count: number;
  wallet_cap: number;
  resale_cap_bps: number;
  discounts: Record<string, number>;
}

export interface PolicyRule {
  id: string;
  group: string;
  severity: "blocker" | "major" | "minor";
  assert: string;
  because: string;
  enforced?: string;
  limitation?: string;
}

export interface OnchainRules {
  denomination: { native_unit_equals: string };
  events: OnchainEventRule[];
  not_on_chain: string[];
  sale_window: { opens_at: string; closes_at: string };
  accounts: { mnemonic: string; platform: number; organizers: Record<string, number>; buyers: number[] };
  rules: PolicyRule[];
}

let rulesCache: OnchainRules | null = null;

export function loadRules(): OnchainRules {
  if (rulesCache) return rulesCache;
  const file = path.join(REPO_ROOT, "contract", "onchain", "rules.yaml");
  const doc = parseYaml(fs.readFileSync(file, "utf8")) as OnchainRules;
  if (!doc?.rules?.length) throw new Error(`no rules in ${file}`);
  if (!doc?.events?.length) throw new Error(`no events in ${file}`);
  rulesCache = doc;
  return doc;
}

/** One sentence for a test name: the rule's assertion, de-wrapped. */
export function ruleText(id: string): string {
  const rule = loadRules().rules.find((r) => r.id === id);
  if (!rule) throw new Error(`no such rule in contract/onchain/rules.yaml: ${id}`);
  return rule.assert.replace(/\s+/g, " ").trim();
}

// ------------------------------------------------------------- the fixtures

export interface SeedSeat {
  id: string;
  event_id: string;
  section: string;
  row: string;
  number: number;
  price_cents: number;
}

let seatCache: SeedSeat[] | null = null;

export function loadSeats(): SeedSeat[] {
  if (!seatCache) {
    const file = path.join(REPO_ROOT, "contract", "seed", "seats.json");
    seatCache = (JSON.parse(fs.readFileSync(file, "utf8")) as { seats: SeedSeat[] }).seats;
  }
  return seatCache;
}

export function seatsForEvent(seedEventId: string): SeedSeat[] {
  return loadSeats().filter((s) => s.event_id === seedEventId);
}

/** rules.yaml identity: `token_id = uint256(keccak256(seat.id))`. */
export function tokenIdOf(seatId: string): bigint {
  return BigInt(keccakUtf8(seatId));
}

/** rules.yaml identity: `event_id = bytes32(keccak256(event.id))`. */
export function eventIdOf(seedEventId: string): string {
  return keccakUtf8(seedEventId);
}

export function discountCodeOf(code: string): string {
  return keccakUtf8(code);
}

/** rules.yaml ONC-003: the section index is the letter's position in sorted order. */
export function sectionLetters(rule: OnchainEventRule): string[] {
  return Object.keys(rule.sections).sort();
}

export function sectionIndex(rule: OnchainEventRule, letter: string): number {
  const at = sectionLetters(rule).indexOf(letter);
  if (at < 0) throw new Error(`${rule.seed_id}: section ${letter} is not declared in rules.yaml`);
  return at;
}

/** The seeded price of a seat, in minor units — which is what one native unit is. */
export function seatPrice(rule: OnchainEventRule, letter: string): bigint {
  return BigInt(rule.sections[letter]);
}

export function unixSeconds(iso: string): number {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) throw new Error(`not a timestamp: ${iso}`);
  return Math.floor(at / 1000);
}

// ------------------------------------------------------------ the interface

/**
 * The ABI every implementation in this family must present, owned by the
 * contract directory and not by any slot.
 *
 * This is the on-chain analogue of `contract/openapi.yaml`: the grader encodes
 * its calls against this file, so an implementation that renames `buy` is
 * ungradable for the same reason a backend that renames `POST /orders` is. The
 * implementation's own declared ABI is checked against it (ONC-001) rather than
 * used in its place — otherwise a candidate could declare any interface they
 * had happened to write and the suite would faithfully grade it.
 */
export function declaredInterface(name: "PrimarySale" | "TicketToken"): Interface {
  const file = path.join(REPO_ROOT, "contract", "onchain", "abi", `${name}.json`);
  const doc = JSON.parse(fs.readFileSync(file, "utf8")) as { abi: unknown[] };
  return new Interface(doc.abi as never);
}

// ------------------------------------------------- what the slot declared

export interface DeployStep {
  index: number;
  kind: "deploy" | "call";
  label: string;
  contract?: string;
  to?: string;
  data: string;
  value: string;
  address?: string;
}

export interface Deployment {
  schema: string;
  chain: { id: number };
  deployer: string;
  fee: { percent: number; fixed_units: string };
  roles: Record<string, string>;
  contracts: Record<string, { address: string; runtime_code_hash: string; abi?: unknown[] }>;
  steps: DeployStep[];
}

export function deploymentPath(): string {
  const raw = process.env.CHAIN_DEPLOYMENT;
  if (!raw || raw.trim() === "") {
    throw new Error(
      "CHAIN_DEPLOYMENT is not set. This suite grades a deployment an implementation " +
        "DECLARED; it deploys nothing of its own and imports nothing from the slot. " +
        "Run `make run` in the slot first, then point CHAIN_DEPLOYMENT at the " +
        "deployment file it wrote. There is deliberately no default: a default would " +
        "silently grade somebody else's chain. See conformance/blockchain/README.md."
    );
  }
  return path.resolve(raw);
}

export function loadDeployment(): Deployment {
  const file = deploymentPath();
  if (!fs.existsSync(file)) {
    throw new Error(`no deployment file at ${file} — did \`make run\` succeed in the slot?`);
  }
  const doc = JSON.parse(fs.readFileSync(file, "utf8")) as Deployment;
  if (doc.schema !== "ticketforge.onchain.deployment/1") {
    throw new Error(`${file}: unknown schema ${JSON.stringify(doc.schema)}`);
  }
  if (!Array.isArray(doc.steps) || doc.steps.length === 0) {
    throw new Error(`${file}: declares no transactions`);
  }
  return doc;
}

/** The product's fee rule — `contract/openapi.yaml`, not a second definition. */
export function quoteMoney(
  subtotal: bigint,
  percentOff: number,
  feePercent: number,
  feeFixed: bigint
): { subtotal: bigint; discount: bigint; fee: bigint; total: bigint } {
  const discount = (subtotal * BigInt(percentOff)) / 100n;
  const fee = ((subtotal - discount) * BigInt(feePercent)) / 100n + feeFixed;
  return { subtotal, discount, fee, total: subtotal - discount + fee };
}
