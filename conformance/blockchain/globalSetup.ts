/**
 * Start the grader's own local development chain, once, for the whole run.
 *
 * Offline by construction (ONC-002): `hardhat node` with no fork URL, no
 * upstream RPC and no key from the environment, on a port the operating system
 * picked. Nothing in this family ever reaches the network — not for a faucet,
 * not for a compiler (the one contract the grader deploys of its own,
 * `attacker/ReentrantOrganizer.sol`, is vendored as bytecode), and not for a
 * block explorer.
 *
 * Ports 8545 and 3000 are deliberately not used even as a fallback: on this
 * repository's development machines they are regularly occupied or killed by
 * something else, and a chain that quietly attached to somebody else's node
 * would produce a grade for the wrong contracts.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

const SUITE_DIR = import.meta.dirname;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Where the chosen RPC URL is left for the test workers.
 *
 * vitest runs test files in worker threads that do not inherit a mutation of
 * `process.env` made here, and `provide()`/`inject()` would have to be threaded
 * through every config that runs these files. A file keyed by the
 * deployment under test is simpler and is also correct when two different
 * deployments are graded at the same time.
 */
export function rpcHandoffPath(): string {
  const key = createHash("sha1").update(process.env.CHAIN_DEPLOYMENT ?? "unset").digest("hex").slice(0, 10);
  return path.join(SUITE_DIR, `.chain-rpc-${key}.json`);
}

async function waitForRpc(url: string, timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (res.ok) {
        const body = (await res.json()) as { result?: string };
        if (body.result) return true;
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

let node: ChildProcess | null = null;

export async function setup(): Promise<void> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const logPath = path.join(SUITE_DIR, ".chain-node.log");
  const log = fs.openSync(logPath, "w");

  node = spawn("npx", ["hardhat", "node", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: SUITE_DIR,
    stdio: ["ignore", log, log],
    detached: true,
  });
  fs.closeSync(log);

  if (!(await waitForRpc(url))) {
    const tail = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8").slice(-1500) : "";
    stopNode();
    throw new Error(`the grader's local chain did not come up on ${url}\n${tail}`);
  }

  fs.writeFileSync(rpcHandoffPath(), JSON.stringify({ rpcUrl: url, pid: node.pid }) + "\n");
  process.env.CHAIN_RPC_URL = url;
}

function stopNode(): void {
  if (!node?.pid) return;
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    try {
      process.kill(-node.pid, signal);
    } catch {
      break;
    }
  }
  node = null;
}

export async function teardown(): Promise<void> {
  // The chain must not outlive the run. A stray node holds a port and, worse,
  // holds the *state* of a previous grading run: the next suite would attach to
  // it through the handoff file and grade contracts nobody deployed today.
  stopNode();
  try {
    fs.rmSync(rpcHandoffPath(), { force: true });
  } catch {
    // nothing to clean up
  }
}
