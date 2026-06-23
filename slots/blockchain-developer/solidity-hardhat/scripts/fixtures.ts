/**
 * The product's fixtures, read rather than retyped.
 *
 * Seat ids, event ids, section prices and organiser identities all come from
 * `contract/seed/`, and which of them go on chain comes from
 * `contract/onchain/rules.yaml`. Nothing in this file invents a number: if a
 * seat's price changes in the seed, the sale this slot deploys changes with it,
 * and so does what the conformance suite expects.
 */

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { ethers } from "ethers";

/**
 * The repository root, so that `contract/seed/` and `contract/onchain/` are
 * read rather than retyped. Overridable because a container mounts the contract
 * directory somewhere else — a slot that shipped its own copy of the fixtures
 * would be free to drift from the product, which is the one thing this family
 * must not do.
 */
export const REPO_ROOT = process.env.TICKETFORGE_ROOT
  ? path.resolve(process.env.TICKETFORGE_ROOT)
  : path.resolve(__dirname, "..", "..", "..", "..");

export interface SeedSeat {
  id: string;
  event_id: string;
  section: string;
  row: string;
  number: number;
  price_cents: number;
}

export interface OnchainEventRule {
  seed_id: string;
  organizer_account: number;
  sections: Record<string, number>;
  seat_count: number;
  wallet_cap: number;
  resale_cap_bps: number;
  discounts: Record<string, number>;
}

export interface OnchainRules {
  events: OnchainEventRule[];
  not_on_chain: string[];
  sale_window: { opens_at: string; closes_at: string };
  accounts: { mnemonic: string; platform: number; organizers: Record<string, number>; buyers: number[] };
}

export function loadRules(): OnchainRules {
  const file = path.join(REPO_ROOT, "contract", "onchain", "rules.yaml");
  const doc = parseYaml(fs.readFileSync(file, "utf8")) as OnchainRules;
  if (!doc?.events?.length) throw new Error(`no events in ${file}`);
  return doc;
}

export function loadSeats(): SeedSeat[] {
  const file = path.join(REPO_ROOT, "contract", "seed", "seats.json");
  return (JSON.parse(fs.readFileSync(file, "utf8")) as { seats: SeedSeat[] }).seats;
}

/** ONC-003: the section index is the position of the letter in sorted order. */
export function sectionIndex(rule: OnchainEventRule, section: string): number {
  const letters = Object.keys(rule.sections).sort();
  const at = letters.indexOf(section);
  if (at < 0) throw new Error(`${rule.seed_id}: section ${section} is not in rules.yaml`);
  return at;
}

/** ONC-003: section prices, as an array indexed the way `sectionIndex` says. */
export function sectionPrices(rule: OnchainEventRule): bigint[] {
  return Object.keys(rule.sections)
    .sort()
    .map((letter) => BigInt(rule.sections[letter]));
}

/** `contract/onchain/rules.yaml` identity: token_id = uint256(keccak256(seat_id)). */
export function tokenIdOf(seatId: string): bigint {
  return BigInt(ethers.id(seatId));
}

/** `contract/onchain/rules.yaml` identity: event_id = bytes32(keccak256(event_id)). */
export function eventIdOf(seedEventId: string): string {
  return ethers.id(seedEventId);
}

export function seatsForEvent(seats: SeedSeat[], seedEventId: string): SeedSeat[] {
  return seats.filter((s) => s.event_id === seedEventId);
}

export function unixSeconds(iso: string): number {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) throw new Error(`not a timestamp: ${iso}`);
  return Math.floor(at / 1000);
}
