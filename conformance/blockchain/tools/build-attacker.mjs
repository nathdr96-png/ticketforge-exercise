/**
 * Regenerate attacker/ReentrantOrganizer.json from its Solidity source.
 *
 * Run by hand (`npm run attacker`), never during a conformance run, which
 * deploys the vendored bytecode so that it needs no Solidity compiler and
 * therefore no network — see conformance/blockchain/README.md.
 *
 * The compile is delegated to slots/blockchain-developer/solidity-hardhat, which already
 * pins the compiler version and optimizer settings. One pinned toolchain beats
 * a second set of settings here that could drift from it.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SUITE = path.resolve(import.meta.dirname, "..");
const REPO = path.resolve(SUITE, "..", "..");
const SLOT = path.join(REPO, "slots", "blockchain", "solidity-hardhat");
const SOURCE = path.join(SUITE, "attacker", "ReentrantOrganizer.sol");
const OUT = path.join(SUITE, "attacker", "ReentrantOrganizer.json");
// Staged into the slot to be compiled, because that slot already pins the
// compiler version and the optimizer settings.
const staged = path.join(SLOT, "contracts", "test", "ReentrantOrganizer.sol");
if (fs.existsSync(staged)) {
  throw new Error(`${staged} already exists — refusing to overwrite a slot source file`);
}

fs.copyFileSync(SOURCE, staged);
try {
  execFileSync("npx", ["hardhat", "compile"], { cwd: SLOT, stdio: "inherit" });
  const artifact = JSON.parse(
    fs.readFileSync(
      path.join(SLOT, "artifacts", "contracts", "test", "ReentrantOrganizer.sol", "ReentrantOrganizer.json"),
      "utf8"
    )
  );
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        _comment: [
          "Compiled artifact for a withdrawal recipient that calls back (ReentrantOrganizer).",
          "Source: ReentrantOrganizer.sol, next to this file.",
          "solc 0.8.28, optimizer enabled, runs 200, evmVersion cancun.",
          "Vendored rather than compiled during a conformance run, so deploying it needs",
          "no Solidity compiler and therefore no network. Regenerate with `npm run attacker`.",
        ],
        contractName: artifact.contractName,
        abi: artifact.abi,
        bytecode: artifact.bytecode,
      },
      null,
      2
    ) + "\n"
  );
  console.log(`wrote ${path.relative(REPO, OUT)}`);
} finally {
  fs.rmSync(staged, { force: true });
  fs.rmSync(path.join(SLOT, "artifacts", "contracts", "test", "ReentrantOrganizer.sol"), {
    recursive: true,
    force: true,
  });
}
