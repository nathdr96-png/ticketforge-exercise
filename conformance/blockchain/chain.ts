/**
 * The grader's chain, and how the implementation's deployment gets onto it.
 *
 * `globalSetup.ts` starts one local development chain for the whole run. This
 * file replays the step list the slot declared in `$CHAIN_DEPLOYMENT` onto it
 * and hands the tests back live contract handles — built from
 * `contract/onchain/abi/`, never from the slot's build output.
 *
 * Why replay rather than connect to the slot's own chain: a slot's `make run`
 * is a batch job, the same shape the data family uses. It runs to completion and leaves a declaration behind;
 * its chain is gone by the time the grader starts. Replaying the declaration is
 * what turns that declaration into something that can be driven, and the
 * address check that comes with it (ONC-001) is strictly stronger than trusting
 * a running node somebody else started: a CREATE address is a pure function of
 * (deployer, nonce), so reproducing every declared address proves the declared
 * calldata is the whole truth about how those contracts came to exist.
 */

import fs from "node:fs";
import { Contract, JsonRpcProvider, Mnemonic, HDNodeWallet, keccak256, type Wallet } from "ethers";
import { rpcHandoffPath } from "./globalSetup.js";
import {
  type Deployment,
  declaredInterface,
  loadDeployment,
  loadRules,
  unixSeconds,
} from "./contract.js";

/**
 * A fixed instant inside the declared sale window, so that nothing in this
 * suite depends on the wall clock. The chain is moved here after every reset.
 */
const TEST_CLOCK_ISO = "2030-01-01T00:00:00Z";

export function rpcUrl(): string {
  if (process.env.CHAIN_RPC_URL) return process.env.CHAIN_RPC_URL;
  // vitest test files run in worker threads that do not see a mutation of
  // process.env made in globalSetup, so the port is handed over in a file.
  const handoff = rpcHandoffPath();
  if (fs.existsSync(handoff)) {
    return (JSON.parse(fs.readFileSync(handoff, "utf8")) as { rpcUrl: string }).rpcUrl;
  }
  throw new Error(
    `no local chain to talk to: neither CHAIN_RPC_URL nor ${handoff}. The chain is ` +
      `started by globalSetup.ts — if you are seeing this, the suite was run without ` +
      `its global setup.`
  );
}

let provider: JsonRpcProvider | null = null;

export function chainProvider(): JsonRpcProvider {
  if (!provider) {
    // `staticNetwork` stops ethers re-probing the chain id on every call, which
    // on a local node is most of the wall time of a long fuzz run.
    provider = new JsonRpcProvider(rpcUrl(), undefined, { staticNetwork: true, cacheTimeout: -1 });
  }
  return provider;
}

/** The standard local-chain accounts, by index. rules.yaml `accounts`. */
export function account(index: number): HDNodeWallet {
  const { mnemonic } = loadRules().accounts;
  return HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(mnemonic), `m/44'/60'/0'/0/${index}`).connect(
    chainProvider()
  );
}

export type Signer = HDNodeWallet | Wallet;

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  return chainProvider().send(method, params) as Promise<T>;
}

export interface Sale {
  deployment: Deployment;
  /** The sale contract, bound to the CONTRACT's declared ABI. */
  sale: Contract;
  token: Contract;
  saleAddress: string;
  tokenAddress: string;
  platform: HDNodeWallet;
}

/**
 * Replay the declared deployment and assert it reproduces itself (ONC-001).
 *
 * Returns the mismatches rather than throwing, so `deployment.test.ts` can
 * report all of them at once and the other suites can refuse to run.
 */
export async function replayDeployment(): Promise<{ sale: Sale | null; problems: string[] }> {
  const deployment = loadDeployment();
  const problems: string[] = [];

  await rpc("hardhat_reset", [{}]);

  const platform = account(loadRules().accounts.platform);
  if (platform.address.toLowerCase() !== deployment.deployer.toLowerCase()) {
    problems.push(
      `the deployment declares deployer ${deployment.deployer}, which is not account ` +
        `${loadRules().accounts.platform} of the standard local mnemonic (${platform.address}). ` +
        `contract/onchain/rules.yaml fixes the role accounts precisely so that a replay is ` +
        `possible without a private key from the environment.`
    );
    return { sale: null, problems };
  }

  const deployed: Record<string, string> = {};
  for (const step of deployment.steps) {
    const tx = await platform.sendTransaction({
      to: step.kind === "deploy" ? undefined : step.to,
      data: step.data,
      value: BigInt(step.value ?? "0"),
    });
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      problems.push(`step ${step.index} (${step.label}) reverted when replayed`);
      return { sale: null, problems };
    }
    if (step.kind !== "deploy") continue;

    const got = receipt.contractAddress ?? "";
    if (got.toLowerCase() !== (step.address ?? "").toLowerCase()) {
      problems.push(
        `step ${step.index} (${step.label}) declares address ${step.address} but replaying it ` +
          `produced ${got}. A CREATE address is determined by the deployer and its nonce, so ` +
          `this means the declared step list is not the whole set of transactions the deployer ` +
          `sent, or not in that order.`
      );
    }
    deployed[step.contract ?? `step${step.index}`] = got;
  }

  for (const [name, declared] of Object.entries(deployment.contracts)) {
    const got = deployed[name];
    if (!got) {
      problems.push(`contract ${name} is declared at ${declared.address} but no step deploys it`);
      continue;
    }
    const hash = keccak256(await chainProvider().getCode(got));
    if (hash !== declared.runtime_code_hash) {
      problems.push(
        `${name}: runtime code at ${got} hashes to ${hash}, but the deployment declares ` +
          `${declared.runtime_code_hash}.`
      );
    }
  }

  for (const required of ["PrimarySale", "TicketToken"]) {
    if (!deployed[required]) {
      problems.push(`no step deploys a contract named ${required}`);
    }
  }
  if (problems.length > 0) return { sale: null, problems };

  await moveClockInsideSaleWindow();

  const saleAddress = deployed.PrimarySale;
  const tokenAddress = deployed.TicketToken;
  return {
    sale: {
      deployment,
      saleAddress,
      tokenAddress,
      platform,
      sale: new Contract(saleAddress, declaredInterface("PrimarySale"), platform),
      token: new Contract(tokenAddress, declaredInterface("TicketToken"), platform),
    },
    problems,
  };
}

/** Put the chain at a fixed instant inside the declared window. */
export async function moveClockInsideSaleWindow(): Promise<void> {
  const { sale_window } = loadRules();
  const opens = unixSeconds(sale_window.opens_at);
  const closes = unixSeconds(sale_window.closes_at);
  const block = await chainProvider().getBlock("latest");
  const want = Math.max(unixSeconds(TEST_CLOCK_ISO), (block?.timestamp ?? 0) + 60);
  if (want < opens || want >= closes) {
    throw new Error(
      `the grader's fixed test clock (${new Date(want * 1000).toISOString()}) is outside the sale ` +
        `window declared in contract/onchain/rules.yaml (${sale_window.opens_at} .. ` +
        `${sale_window.closes_at}). Move the window, not the clock.`
    );
  }
  await setBlockTime(want);
}

/** Mine a block at `unix`. The NEXT transaction therefore executes a second or
 * more later, so a boundary assertion uses `setNextBlockTime` instead. */
export async function setBlockTime(unix: number): Promise<void> {
  await rpc("evm_setNextBlockTimestamp", [unix]);
  await rpc("evm_mine", []);
}

/** Pin the timestamp of the next block without mining one, so the next
 * transaction executes at exactly `unix`. This is how a half-open window is
 * asserted on its boundary rather than near it. */
export async function setNextBlockTime(unix: number): Promise<void> {
  await rpc("evm_setNextBlockTimestamp", [unix]);
}

export async function snapshot(): Promise<string> {
  return rpc<string>("evm_snapshot", []);
}

export async function revertTo(id: string): Promise<void> {
  await rpc<boolean>("evm_revert", [id]);
}

// A replay costs a dozen transactions; a fuzz run needs a clean chain hundreds
// of times. So replay once per worker process and reach for a snapshot after
// that. (vitest runs this suite with fileParallelism disabled, so no two files
// are ever driving the same chain at the same time.)
let cached: { sale: Sale; snapshotId: string } | null = null;
let replayProblems: string[] | null = null;

/** A freshly deployed sale, ready to drive. Throws if the replay did not hold. */
export async function freshSale(): Promise<Sale> {
  if (cached) {
    await revertTo(cached.snapshotId);
    cached.snapshotId = await snapshot();
    return cached.sale;
  }
  if (replayProblems) throw new Error("deployment replay failed:\n" + replayProblems.join("\n"));
  const { sale, problems } = await replayDeployment();
  if (!sale) {
    replayProblems = problems;
    throw new Error("deployment replay failed:\n" + problems.join("\n"));
  }
  cached = { sale, snapshotId: await snapshot() };
  return sale;
}

/** Bind the sale/token to another account. */
export function asAccount(sale: Sale, who: Signer): { sale: Contract; token: Contract } {
  return { sale: sale.sale.connect(who) as Contract, token: sale.token.connect(who) as Contract };
}

/**
 * The reason a call reverted, as the custom-error name the CONTRACT's declared
 * ABI gives it.
 *
 * Decoded here rather than left to the library: a revert raised while
 * estimating gas comes back as four bytes of selector with no interpretation
 * attached, and "execution reverted" is not an assertion anybody can read. The
 * selector is matched against `contract/onchain/abi/`, so the name in a failure
 * message is the name in the contract, not the name in the implementation.
 */
export async function revertName(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "<did not revert>";
  } catch (err) {
    const e = err as {
      revert?: { name?: string };
      data?: unknown;
      info?: { error?: { data?: unknown } };
      error?: { data?: unknown };
      shortMessage?: string;
      message?: string;
    };
    if (e.revert?.name) return e.revert.name;
    const raw = e.data ?? e.info?.error?.data ?? e.error?.data;
    if (typeof raw === "string" && raw.startsWith("0x") && raw.length >= 10) {
      for (const name of ["PrimarySale", "TicketToken"] as const) {
        const parsed = declaredInterface(name).parseError(raw);
        if (parsed) return parsed.name;
      }
    }
    return e.shortMessage ?? e.message ?? "<unknown>";
  }
}
