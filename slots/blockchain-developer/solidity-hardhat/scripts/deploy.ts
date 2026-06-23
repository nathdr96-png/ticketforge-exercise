/**
 * Deploy the on-chain primary sale to a local development chain and declare
 * what was deployed.
 *
 * `make run` runs this. It boots an in-process Hardhat Network — no RPC URL, no
 * fork, no faucet, no key from the environment (ONC-002) — sends every
 * transaction the deployment needs, and writes the single file that is this
 * slot's whole interface with the grader:
 *
 *     $CHAIN_DEPLOYMENT  (default: ./deployment/deployment.json)
 *
 * The file records every transaction the deployer sent, in order, as calldata.
 * conformance/blockchain replays that list onto a chain it owns and asserts
 * that every declared address comes back identical (ONC-001). A CREATE address
 * is a pure function of (deployer, nonce), so that single assertion proves the
 * declared bytecode is what produced the declared addresses and that nothing
 * undeclared happened in between — which is how the grader can drive these
 * contracts without ever importing this project.
 */

import fs from "node:fs";
import path from "node:path";
import { ethers } from "hardhat";
import { keccak256 } from "ethers";
import {
  eventIdOf,
  loadRules,
  loadSeats,
  sectionIndex,
  sectionPrices,
  seatsForEvent,
  tokenIdOf,
  unixSeconds,
} from "./fixtures";

/** The product's published fee rule. One definition, and this is not it —
 * `contract/openapi.yaml` is. These are its two parameters. */
const FEE_PERCENT = Number(process.env.FEE_PERCENT ?? 5);
const FEE_FIXED_UNITS = BigInt(process.env.FEE_FIXED_CENTS ?? 30);

/** Seats per `registerSeats` transaction. Small enough to stay well inside a
 * block, large enough that a 100-seat event is two transactions and not a
 * hundred. */
const SEAT_BATCH = 50;

interface Step {
  index: number;
  kind: "deploy" | "call";
  label: string;
  data: string;
  value: string;
  /** Set on a `deploy` step: the contract's name in this implementation. */
  contract?: string;
  /** Set on a `deploy` step: where it landed. */
  address?: string;
  /** Set on a `call` step. */
  to?: string;
}

async function main(): Promise<void> {
  const rules = loadRules();
  const seats = loadSeats();
  const signers = await ethers.getSigners();
  const deployer = signers[rules.accounts.platform];

  const opensAt = unixSeconds(rules.sale_window.opens_at);
  const closesAt = unixSeconds(rules.sale_window.closes_at);

  const steps: Step[] = [];
  const contracts: Record<string, { address: string; runtime_code_hash: string; abi: unknown }> = {};

  // Every transaction goes through here, so the file cannot drift from what was
  // actually sent: the same `data` string is both recorded and broadcast.
  async function send(step: Omit<Step, "index" | "address">): Promise<string> {
    const index = steps.length;
    const tx = await deployer.sendTransaction({
      to: step.kind === "deploy" ? undefined : step.to,
      data: step.data,
      value: BigInt(step.value),
    });
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw new Error(`step ${index} (${step.label}) reverted`);
    const address = receipt.contractAddress ?? "";
    steps.push(step.kind === "deploy" ? { ...step, index, address } : { ...step, index });
    return address;
  }

  async function deploy(name: string, args: unknown[]): Promise<string> {
    const factory = await ethers.getContractFactory(name, deployer);
    const unsigned = await factory.getDeployTransaction(...args);
    const address = await send({ kind: "deploy", contract: name, label: `deploy ${name}`, data: unsigned.data!, value: "0" });
    contracts[name] = {
      address,
      runtime_code_hash: keccak256(await ethers.provider.getCode(address)),
      abi: JSON.parse(factory.interface.formatJson()),
    };
    console.log(`  deployed ${name} at ${address}`);
    return address;
  }

  async function call(name: string, address: string, fn: string, args: unknown[]): Promise<void> {
    const factory = await ethers.getContractFactory(name, deployer);
    await send({
      kind: "call",
      label: `${name}.${fn}`,
      to: address,
      data: factory.interface.encodeFunctionData(fn, args),
      value: "0",
    });
  }

  console.log(`deployer (platform role): ${deployer.address}`);

  // The two contracts reference each other, so one of them has to go second and
  // be wired up afterwards. That third transaction is why the declared
  // interface is a STEP LIST and not just a map of addresses.
  const saleAddress = await deploy("PrimarySale", [deployer.address, FEE_PERCENT, FEE_FIXED_UNITS]);
  const tokenAddress = await deploy("TicketToken", [saleAddress]);
  await call("PrimarySale", saleAddress, "setTicketToken", [tokenAddress]);

  const roles: Record<string, string> = { platform: deployer.address };

  for (const rule of rules.events) {
    const organizer = signers[rule.organizer_account];
    roles[rule.seed_id] = organizer.address;
    const eventId = eventIdOf(rule.seed_id);
    const mine = seatsForEvent(seats, rule.seed_id);
    if (mine.length !== rule.seat_count) {
      throw new Error(
        `${rule.seed_id}: contract/seed/seats.json has ${mine.length} seats but ` +
          `contract/onchain/rules.yaml declares ${rule.seat_count}`
      );
    }

    await call("PrimarySale", saleAddress, "registerEvent", [
      eventId,
      organizer.address,
      opensAt,
      closesAt,
      rule.wallet_cap,
      rule.resale_cap_bps,
      sectionPrices(rule),
    ]);

    for (let at = 0; at < mine.length; at += SEAT_BATCH) {
      const batch = mine.slice(at, at + SEAT_BATCH);
      await call("PrimarySale", saleAddress, "registerSeats", [
        eventId,
        batch.map((s) => tokenIdOf(s.id)),
        batch.map((s) => sectionIndex(rule, s.section)),
      ]);
    }

    for (const [code, percentOff] of Object.entries(rule.discounts ?? {})) {
      await call("PrimarySale", saleAddress, "registerDiscount", [eventId, ethers.id(code), percentOff]);
    }

    await call("PrimarySale", saleAddress, "sealEvent", [eventId]);
    console.log(`  registered ${rule.seed_id}: ${mine.length} seats, organizer ${organizer.address}`);
  }

  const out = process.env.CHAIN_DEPLOYMENT
    ? path.resolve(process.env.CHAIN_DEPLOYMENT)
    : path.resolve(__dirname, "..", "deployment", "deployment.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const network = await ethers.provider.getNetwork();
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        schema: "ticketforge.onchain.deployment/1",
        chain: { id: Number(network.chainId), local_only: true, mnemonic: "standard local development mnemonic" },
        deployer: deployer.address,
        fee: { percent: FEE_PERCENT, fixed_units: FEE_FIXED_UNITS.toString() },
        roles,
        contracts,
        steps,
      },
      null,
      2
    ) + "\n"
  );
  console.log(`wrote ${out} (${steps.length} transactions)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
